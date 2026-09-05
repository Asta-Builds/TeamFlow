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
      parsedUrl = new URL(targetUrl);
    } catch {
      throw new BadRequestException(`Invalid URL format: ${targetUrl}`);
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

    let loadTimeMs = 350;
    let html = '';
    let robotsTxtPresent = false;
    let sitemapPresent = false;

    // Resolve localhost to Docker service name when inside container
    let probeUrl = targetUrl;
    if (process.env.DATABASE_URL?.includes('@db:') || process.env.PYTHON_AI_SERVICE_URL?.includes('backend')) {
      probeUrl = probeUrl
        .replace('localhost:3000', 'frontend:3000')
        .replace('127.0.0.1:3000', 'frontend:3000');
    }

    const startTime = Date.now();
    try {
      const response = await this.httpService.axiosRef.get(probeUrl, {
        timeout: 10000,
        maxRedirects: 5,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; TeamFlowBot/1.0; +https://teamflow.dev)',
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
      });
      if (rResp.status >= 200 && rResp.status < 400) robotsTxtPresent = true;
    } catch {
      robotsTxtPresent = false;
    }

    try {
      const sitemapUrl = `${parsedUrl.origin}/sitemap.xml`;
      const sResp = await this.httpService.axiosRef.head(sitemapUrl, {
        timeout: 3000,
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
    let perfScore =
      loadTimeMs < 300
        ? 98
        : loadTimeMs < 600
          ? 92
          : loadTimeMs < 1200
            ? 80
            : loadTimeMs < 2500
              ? 65
              : 45;
    if (!isHttps) perfScore = Math.max(30, perfScore - 20);

    let seoScore = 100;
    for (const issue of issues) {
      if (issue.severity === 'critical') seoScore -= 20;
      else if (issue.severity === 'high') seoScore -= 12;
      else if (issue.severity === 'medium') seoScore -= 6;
      else if (issue.severity === 'low') seoScore -= 3;
    }
    seoScore = Math.max(20, Math.min(100, seoScore));

    const mobileScore = /<meta\s+[^>]*name=["']viewport["']/i.test(html)
      ? 96
      : 55;
    const overallScore = Math.round(
      (perfScore * 0.4 + seoScore * 0.4 + mobileScore * 0.2),
    );

    const metrics = {
      fcp_ms: Math.round(loadTimeMs * 0.65),
      lcp_ms: Math.round(loadTimeMs * 1.3),
      cls: 0.02,
      fid_ms: 18,
      ttfb_ms: Math.round(loadTimeMs * 0.35),
      canonical_detected: /<link\s+[^>]*rel=["']canonical["']/i.test(html),
      robots_txt_present: robotsTxtPresent,
      sitemap_present: sitemapPresent,
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
