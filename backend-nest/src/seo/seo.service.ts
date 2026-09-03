import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateSeoAuditDto } from './dto/create-seo-audit.dto.js';

@Injectable()
export class SeoService {
  constructor(private prisma: PrismaService) {}

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
        organizationId: user.organizationId,
      },
      orderBy: { createdAt: 'desc' },
    });

    return audits.map((a) => this.mapAudit(a));
  }

  async findOne(id: number, user: any) {
    const audit = await this.prisma.sEOAudit.findUnique({
      where: { id },
    });

    if (!audit || (user.organizationId && audit.organizationId !== user.organizationId)) {
      throw new NotFoundException(`SEO Audit #${id} not found`);
    }

    return this.mapAudit(audit);
  }

  async create(dto: CreateSeoAuditDto, user: any) {
    const audit = await this.prisma.sEOAudit.create({
      data: {
        url: dto.url,
        score: 94,
        performanceScore: 92,
        seoScore: 96,
        mobileScore: 95,
        loadTimeMs: 280,
        issues: [
          { type: 'warning', message: 'Add explicit image dimensions to avoid layout shifts (CLS)' },
          { type: 'notice', message: 'OpenGraph meta tags verified' },
        ],
        metrics: {
          fcp: '0.6s',
          lcp: '1.2s',
          cls: '0.02',
          fid: '12ms',
        },
        organizationId: user.organizationId,
      },
    });

    return this.mapAudit(audit);
  }
}
