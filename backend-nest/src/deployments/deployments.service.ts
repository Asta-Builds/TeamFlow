import { requireOrganization, requireProject } from '../common/access.js';
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateDeploymentDto } from './dto/create-deployment.dto.js';

@Injectable()
export class DeploymentsService {
  constructor(private prisma: PrismaService) {}

  private isPrivileged(user: any): boolean {
    return (
      user.isStaff ||
      user.isSuperuser ||
      ['ceo', 'tech_lead', 'admin', 'devops'].includes(user.role)
    );
  }

  private mapDeployment(d: any) {
    return {
      id: d.id,
      project: d.projectId,
      project_name: d.project?.name,
      environment: d.environment,
      status: d.status,
      commit_sha: d.commitSha,
      branch: d.branch,
      logs: d.logs,
      duration_seconds: d.durationSeconds,
      triggered_by: d.triggeredById,
      triggered_by_name: d.triggeredBy?.name || d.triggeredBy?.email,
      started_at: d.startedAt.toISOString(),
      finished_at: d.finishedAt ? d.finishedAt.toISOString() : null,
    };
  }

  async findAll(
    user: any,
    query?: { project?: number; environment?: string; status?: string },
  ) {
    const where: any = { organizationId: requireOrganization(user) };
    if (user.organizationId) {
      where.organizationId = user.organizationId;
    }
    if (query?.project) where.projectId = query.project;
    if (query?.environment) where.environment = query.environment;
    if (query?.status) where.status = query.status;

    const deployments = await this.prisma.deployment.findMany({
      where,
      include: {
        project: true,
        triggeredBy: true,
      },
      orderBy: { startedAt: 'desc' },
    });

    return deployments.map((d) => this.mapDeployment(d));
  }

  async findOne(id: number, user: any) {
    requireOrganization(user);
    const deployment = await this.prisma.deployment.findUnique({
      where: { id },
      include: {
        project: true,
        triggeredBy: true,
      },
    });

    if (!deployment) {
      throw new NotFoundException(`Deployment with ID ${id} not found`);
    }

    if (deployment.organizationId !== user.organizationId) {
      throw new ForbiddenException('Access denied across tenants');
    }

    return this.mapDeployment(deployment);
  }

  async create(dto: CreateDeploymentDto, user: any) {
    if (!this.isPrivileged(user)) {
      throw new ForbiddenException(
        'Only DevOps Engineer, Tech Lead or CEO can trigger deployments.',
      );
    }

    await requireProject(this.prisma, dto.project, user);
    throw new ServiceUnavailableException(
      'Deployment execution is not configured',
    );
  }

  async rollback(id: number, user: any) {
    if (!this.isPrivileged(user)) {
      throw new ForbiddenException(
        'Only DevOps Engineer, Tech Lead or CEO can trigger rollback.',
      );
    }

    const deployment = await this.prisma.deployment.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!deployment) {
      throw new NotFoundException(`Deployment with ID ${id} not found`);
    }

    if (deployment.organizationId !== requireOrganization(user)) {
      throw new NotFoundException('Deployment not found');
    }
    await requireProject(this.prisma, deployment.projectId, user);
    throw new ServiceUnavailableException(
      'Rollback execution is not configured',
    );
  }
}
