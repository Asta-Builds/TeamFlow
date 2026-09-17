import { requireOrganization, requireProject } from '../common/access.js';
import {
  BadGatewayException,
  Injectable,
  NotFoundException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateDeploymentDto } from './dto/create-deployment.dto.js';
import { bridgePost } from '../common/python-bridge.js';

/**
 * Deployment history lives in the shared database. Deployments and rollbacks are
 * executed by the Django service, which hands them to the configured provider and
 * records only what the provider reports. Without a provider the API returns 503.
 */
@Injectable()
export class DeploymentsService {
  constructor(
    private prisma: PrismaService,
    @Optional() private httpService?: HttpService,
  ) {}

  private http(): HttpService {
    if (!this.httpService) {
      throw new Error('HttpService is required for deployment execution');
    }
    return this.httpService;
  }

  private mapBridgeDeployment(d: any) {
    return {
      id: d.id,
      project: d.project,
      project_name: d.project_name,
      environment: d.environment,
      status: d.status,
      commit_sha: d.commit_sha,
      branch: d.branch,
      logs: d.logs,
      duration_seconds: d.duration_seconds,
      triggered_by: d.triggered_by,
      triggered_by_name:
        d.triggered_by_detail?.name || d.triggered_by_detail?.email,
      started_at: d.started_at,
      finished_at: d.finished_at,
    };
  }

  private async execute(path: string, body: unknown, user: any) {
    const result = await bridgePost(this.http(), user, path, body);
    const deployment = this.mapBridgeDeployment(result.data);
    if (result.status === 502) {
      throw new BadGatewayException({
        detail: 'The deployment provider rejected the request.',
        deployment,
      });
    }
    return deployment;
  }

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

    requireOrganization(user);
    await requireProject(this.prisma, dto.project, user);

    return this.execute(
      '/api/deployments/',
      {
        project: dto.project,
        environment: dto.environment || 'staging',
        branch: dto.branch || 'main',
        commit_sha: dto.commit_sha?.trim() || '',
      },
      user,
    );
  }

  async rollback(id: number, user: any) {
    if (!this.isPrivileged(user)) {
      throw new ForbiddenException(
        'Only DevOps Engineer, Tech Lead or CEO can trigger rollback.',
      );
    }

    const organizationId = requireOrganization(user);
    const targetDeployment = await this.prisma.deployment.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!targetDeployment) {
      throw new NotFoundException(`Deployment with ID ${id} not found`);
    }

    if (targetDeployment.organizationId !== organizationId) {
      throw new NotFoundException('Deployment not found');
    }

    await requireProject(this.prisma, targetDeployment.projectId, user);

    return this.execute(`/api/deployments/${id}/rollback/`, {}, user);
  }
}
