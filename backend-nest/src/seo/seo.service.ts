import { requireOrganization } from '../common/access.js';
import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
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

  async create(_dto: CreateSeoAuditDto, user: any) {
    requireOrganization(user);
    throw new ServiceUnavailableException(
      'SEO audit execution is not configured',
    );
  }
}
