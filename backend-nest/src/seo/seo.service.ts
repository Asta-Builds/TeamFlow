import { requireOrganization, visibleProjects } from '../common/access.js';
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateSeoAuditDto } from './dto/create-seo-audit.dto.js';
import { CreateSeoTaskDto } from './dto/create-seo-task.dto.js';
import {
  assertAuditableUrl,
  assertRedirectTarget,
  privateTargetsAllowed,
  publicOnlyLookup,
} from '../common/outbound-url.js';

const MAX_AUDIT_BYTES = 5 * 1024 * 1024;

const SCORE_RULES = {
  responseTimeMs: [[300, 98], [600, 92], [1200, 80], [2500, 65]],
  slowScore: 45,
  httpPenalty: 20,
  minPerformance: 30,
  severityPenalty: { critical: 20, high: 12, medium: 6, low: 3 },
  minSeo: 20,
  viewportScore: 96,
  noViewportScore: 55,
  weights: { performance: 0.4, seo: 0.4, mobile: 0.2 }
};

export interface SeoIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'security' | 'metadata' | 'performance' | 'accessibility' | 'indexing';
  message: string;
  recommendation: string;
}

@Injectable()
export class SeoService {
  private readonly logger = new Logger(SeoService.name);

  constructor(
    private prisma: PrismaService,
    private httpService: HttpService,
  ) {}

  private isPrivileged(user: any): boolean {
    return (
      user.isStaff ||
      user.isSuperuser ||
      ['ceo', 'tech_lead', 'admin', 'seo'].includes(user.role)
    );
  }

  private mapAudit(a: any) {
    return {
      id: a.id,
      url: a.url,
      score: a.score,
      performance_score: a.performanceScore,
      seo_score: a.seoScore,
      mobile_score: a.mobileScore,
      load_time_ms: a.loadTimeMs,
      issues: a.issues,
      metrics: a.metrics,
      created_at: a.createdAt.toISOString(),
    };
  }

  async findAll(user: any) {
    const audits = await this.prisma.sEOAudit.findMany({
      where: {
        organizationId: requireOrganization(user),
      },
      orderBy: { createdAt: 'desc' },
    });

    return audits.map((a) => this.mapAudit(a));
  }

  async findOne(id: number, user: any) {
    const audit = await this.prisma.sEOAudit.findFirst({
      where: { id, organizationId: requireOrganization(user) },
    });

    if (
      !audit ||
      (user.organizationId && audit.organizationId !== user.organizationId)
    ) {
      throw new NotFoundException(`SEO Audit #${id} not found`);
    }

    return this.mapAudit(audit);
  }

  async create(dto: CreateSeoAuditDto, user: any) {
    const organizationId = requireOrganization(user);
    if (!this.isPrivileged(user)) {
      throw new ForbiddenException(
        'Only SEO Specialist, Tech Lead or CEO can run audits',
      );
    }

    const targetUrl = dto.url.trim();
    let parsedUrl: URL;
    try {
      parsedUrl = assertAuditableUrl(targetUrl);
    } catch (err: any) {
      throw new BadRequestException(err?.message || `Invalid URL format: ${targetUrl}`);
    }

    const issues: SeoIssue[] = [];
    const isHttps = parsedUrl.protocol === 'https:';

    if (!isHttps) {
      issues.push({
        severity: 'critical',
        category: 'security',
        message:
          'Page is not served over secure HTTPS. Essential for search engine trust.',
        recommendation:
          'Install SSL/TLS certificate and configure HTTP to HTTPS 301 redirection.',
      });
    }

    if (targetUrl.length > 90) {
      issues.push({
        severity: 'low',
        category: 'indexing',
        message: 'URL exceeds recommended 90 character limit.',
        recommendation: 'Use clean, concise semantic slugs.',
      });
    }

    let loadTimeMs = 0;
    let html = '';
    let robotsTxtPresent = false;
    let sitemapPresent = false;

    // Local development only: reach the frontend container when auditing localhost.
    let probeUrl = parsedUrl.toString();
    if (privateTargetsAllowed() && process.env.SEO_LOCAL_TARGET_REWRITES) {
      const rewrites = process.env.SEO_LOCAL_TARGET_REWRITES.split(',');
      for (const rw of rewrites) {
        const [from, to] = rw.split('=');
        if (from && to) {
          const fromHost = from.trim();
          if (parsedUrl.host === fromHost) {
            parsedUrl.host = to.trim();
            probeUrl = parsedUrl.toString();
          }
        }
      }
    }

    const startTime = Date.now();
    try {
      const response = await this.httpService.axiosRef.get(probeUrl, {
        timeout: 10000,
        maxRedirects: 5,
        lookup: publicOnlyLookup,
        beforeRedirect: assertRedirectTarget,
        maxContentLength: MAX_AUDIT_BYTES,
        responseType: 'text',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; TeamFlowBot/1.0)',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      loadTimeMs = Math.max(1, Date.now() - startTime);
      html = typeof response.data === 'string' ? response.data : '';
    } catch (err: any) {
      loadTimeMs = Math.max(1, Date.now() - startTime);
      this.logger.warn(`Failed fetching target URL ${targetUrl}: ${err.message}`);
      issues.push({
        severity: 'critical',
        category: 'performance',
        message: `HTTP probe encountered error: ${err.message}`,
        recommendation: 'Verify server uptime and DNS configuration for target host.',
      });
    }

    // Secondary probes: robots.txt and sitemap.xml
    try {
      const robotsUrl = `${parsedUrl.origin}/robots.txt`;
      const rResp = await this.httpService.axiosRef.head(robotsUrl, {
        timeout: 3000,
        maxRedirects: 3,
        lookup: publicOnlyLookup,
        beforeRedirect: assertRedirectTarget,
      });
      if (rResp.status >= 200 && rResp.status < 400) robotsTxtPresent = true;
    } catch {
      robotsTxtPresent = false;
    }

    try {
      const sitemapUrl = `${parsedUrl.origin}/sitemap.xml`;
      const sResp = await this.httpService.axiosRef.head(sitemapUrl, {
        timeout: 3000,
        maxRedirects: 3,
        lookup: publicOnlyLookup,
        beforeRedirect: assertRedirectTarget,
      });
      if (sResp.status >= 200 && sResp.status < 400) sitemapPresent = true;
    } catch {
      sitemapPresent = false;
    }

    // HTML Heuristics analysis
    if (html) {
      // 1. Title tag
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : '';
      if (!title) {
        issues.push({
          severity: 'high',
          category: 'metadata',
          message: 'Missing document <title> tag.',
          recommendation:
            'Add a unique and descriptive <title> in document head.',
        });
      } else if (title.length < 30 || title.length > 65) {
        issues.push({
          severity: 'medium',
          category: 'metadata',
          message: `Title tag length (${title.length} characters) is outside the recommended 30–65 character range.`,
          recommendation:
            'Optimize title length between 30 and 65 characters to prevent SERP truncation.',
        });
      }

      // 2. Meta description
      const descMatch = html.match(
        /<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i,
      ) || html.match(
        /<meta\s+[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i,
      );
      const desc = descMatch ? descMatch[1].trim() : '';
      if (!desc) {
        issues.push({
          severity: 'high',
          category: 'metadata',
          message: 'Missing meta description tag.',
          recommendation:
            'Add <meta name="description" content="..."> with compelling summary.',
        });
      } else if (desc.length < 70 || desc.length > 160) {
        issues.push({
          severity: 'medium',
          category: 'metadata',
          message: `Meta description length (${desc.length} chars) is outside optimal 70–160 character range.`,
          recommendation: 'Target between 70 and 160 characters for snippets.',
        });
      }

      // 3. Viewport tag
      const hasViewport = /<meta\s+[^>]*name=["']viewport["']/i.test(html);
      if (!hasViewport) {
        issues.push({
          severity: 'high',
          category: 'accessibility',
          message: 'Missing viewport meta tag for mobile responsiveness.',
          recommendation:
            'Include <meta name="viewport" content="width=device-width, initial-scale=1">.',
        });
      }

      // 4. Canonical link tag
      const hasCanonical = /<link\s+[^>]*rel=["']canonical["']/i.test(html);
      if (!hasCanonical) {
        issues.push({
          severity: 'medium',
          category: 'indexing',
          message: 'Missing canonical link tag (<link rel="canonical">).',
          recommendation:
            'Define canonical URL to avoid duplicate content penalties.',
        });
      }

      // 5. OpenGraph tags
      const hasOgImage = /<meta\s+[^>]*property=["']og:image["']/i.test(html);
      if (!hasOgImage) {
        issues.push({
          severity: 'medium',
          category: 'metadata',
          message:
            "Missing OpenGraph image tag ('og:image') for social media previews.",
          recommendation:
            'Add <meta property="og:image" content="..."> in head.',
        });
      }

      // 6. Image alt attributes
      const imgTags = html.match(/<img\s+[^>]*>/gi) || [];
      let missingAltCount = 0;
      for (const img of imgTags) {
        if (!/alt=["'][^"']*["']/i.test(img)) {
          missingAltCount++;
        }
      }
      if (missingAltCount > 0) {
        issues.push({
          severity: 'low',
          category: 'accessibility',
          message: `${missingAltCount} image asset(s) are missing descriptive 'alt' text attributes.`,
          recommendation:
            'Provide meaningful alt text for screen readers and search bot image indexing.',
        });
      }

      // 7. Headings
      const h1Count = (html.match(/<h1[^>]*>/gi) || []).length;
      if (h1Count === 0) {
        issues.push({
          severity: 'medium',
          category: 'metadata',
          message: 'Document is missing a primary <h1> heading tag.',
          recommendation:
            'Include exactly one semantic <h1> describing page content.',
        });
      }
    }

    if (!robotsTxtPresent) {
      issues.push({
        severity: 'low',
        category: 'indexing',
        message: 'Robots exclusion standard file (/robots.txt) was not detected.',
        recommendation:
          'Create /robots.txt to guide search engine web crawlers.',
      });
    }

    // Scoring algorithms
    let perfScore = SCORE_RULES.slowScore;
    for (const [limit, score] of SCORE_RULES.responseTimeMs) {
      if (loadTimeMs < limit) {
        perfScore = score;
        break;
      }
    }
    if (!isHttps) perfScore = Math.max(SCORE_RULES.minPerformance, perfScore - SCORE_RULES.httpPenalty);

    let seoScore = 100;
    for (const issue of issues) {
      seoScore -= SCORE_RULES.severityPenalty[issue.severity as keyof typeof SCORE_RULES.severityPenalty] || 0;
    }
    seoScore = Math.max(SCORE_RULES.minSeo, Math.min(100, seoScore));

    const mobileScore = /<meta\s+[^>]*name=["']viewport["']/i.test(html)
      ? SCORE_RULES.viewportScore
      : SCORE_RULES.noViewportScore;
    const overallScore = Math.round(
      (perfScore * SCORE_RULES.weights.performance + seoScore * SCORE_RULES.weights.seo + mobileScore * SCORE_RULES.weights.mobile),
    );

    const metrics = {
      response_time_ms: loadTimeMs,
      canonical_detected: /<link\s+[^>]*rel=["']canonical["']/i.test(html),
      robots_txt_present: robotsTxtPresent,
      sitemap_present: sitemapPresent,
      measured_with: 'http_fetch',
    };

    const audit = await this.prisma.sEOAudit.create({
      data: {
        url: targetUrl,
        score: overallScore,
        performanceScore: perfScore,
        seoScore: seoScore,
        mobileScore: mobileScore,
        loadTimeMs,
        issues: issues as any,
        metrics: metrics as any,
        organizationId,
      },
    });

    return this.mapAudit(audit);
  }

  async createTask(id: number, dto: CreateSeoTaskDto, user: any) {
    const organizationId = requireOrganization(user);
    const audit = await this.prisma.sEOAudit.findFirst({
      where: { id, organizationId },
    });

    if (!audit) {
      throw new NotFoundException(`SEO Audit #${id} not found`);
    }

    const project = await this.prisma.project.findFirst({
      where: {
        id: dto.project_id,
        organizationId,
        ...visibleProjects(user),
      },
    });

    if (!project) {
      throw new NotFoundException(`Project #${dto.project_id} not found`);
    }

    const issues = (audit.issues as any[]) || [];
    const issueIndex = dto.issue_index ?? 0;
    if (issueIndex < 0 || issueIndex >= issues.length) {
      throw new BadRequestException(
        `Invalid issue index: ${issueIndex}. Audit has ${issues.length} issue(s).`,
      );
    }

    const issue = issues[issueIndex];
    const priority =
      issue.severity === 'critical' || issue.severity === 'high'
        ? 'high'
        : 'medium';

    const task = await this.prisma.task.create({
      data: {
        projectId: project.id,
        organizationId,
        createdById: user.id,
        title: `SEO: ${(issue.message || 'Fix SEO Issue').slice(0, 80)}`,
        description: `Automated ticket created from SEO audit on ${audit.url}.\n\nCategory: ${issue.category}\nSeverity: ${issue.severity}\nRecommendation: ${issue.recommendation || ''}`,
        taskType: 'task',
        priority,
        status: 'todo',
      },
    });

    return {
      status: 'task created',
      task_id: task.id,
    };
  }
}
