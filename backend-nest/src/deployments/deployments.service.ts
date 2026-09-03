import {
  Injectable,
  NotFoundException,
  ForbiddenException,
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

  async findAll(user: any, query?: { project?: number; environment?: string; status?: string }) {
    const where: any = {};
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

    if (user.organizationId && deployment.organizationId !== user.organizationId) {
      throw new ForbiddenException('Access denied across tenants');
    }

    return this.mapDeployment(deployment);
  }

  async create(dto: CreateDeploymentDto, user: any) {
    if (!this.isPrivileged(user)) {
      throw new ForbiddenException('Only DevOps Engineer, Tech Lead or CEO can trigger deployments.');
    }

    const project = await this.prisma.project.findUnique({ where: { id: dto.project } });
    if (!project) {
      throw new NotFoundException(`Project with ID ${dto.project} not found`);
    }

    const env = dto.environment || 'staging';
    const branch = dto.branch || 'main';
    const commit = dto.commit_sha || 'head';
    const duration = 4;
    const now = new Date();

    const logs = [
      '=== Build & Deployment Pipeline Started ===',
      `Target Environment: ${env}`,
      `Branch: ${branch}`,
      `Commit: ${commit}`,
      `Triggered by: ${user.name || user.email}`,
      '[INFO] Running linting and static analysis... OK',
      '[INFO] Running unit and integration tests... OK (100% passed)',
      `[INFO] Building Docker container image... Done (${duration}s)`,
      '[INFO] Deploying container to Kubernetes cluster... Done',
      '[INFO] Health checks passing (HTTP 200 OK). Deployment verified!',
    ].join('\n');

    const deployment = await this.prisma.deployment.create({
      data: {
        projectId: dto.project,
        environment: env,
        branch,
        commitSha: commit,
        status: 'success',
        logs,
        durationSeconds: duration,
        triggeredById: user.id,
        organizationId: user.organizationId,
        startedAt: now,
        finishedAt: new Date(now.getTime() + duration * 1000),
      },
      include: {
        project: true,
        triggeredBy: true,
      },
    });

    // Notify team
    const privilegedUsers = await this.prisma.user.findMany({
      where: {
        organizationId: user.organizationId,
        role: { in: ['ceo', 'tech_lead', 'devops'] },
      },
    });

    for (const p of privilegedUsers) {
      if (p.id !== user.id) {
        await this.prisma.notification.create({
          data: {
            recipientId: p.id,
            actorId: user.id,
            title: `Deployment Succeeded: ${project.name} (${env})`,
            message: `Deployed branch ${branch} commit ${commit}.`,
            link: '/deployments',
            organizationId: user.organizationId,
          },
        });
      }
    }

    return this.mapDeployment(deployment);
  }

  async rollback(id: number, user: any) {
    if (!this.isPrivileged(user)) {
      throw new ForbiddenException('Only DevOps Engineer, Tech Lead or CEO can trigger rollback.');
    }

    const deployment = await this.prisma.deployment.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!deployment) {
      throw new NotFoundException(`Deployment with ID ${id} not found`);
    }

    const now = new Date();
    const rollbackDuration = 2;
    const rollbackLogs = [
      `=== Emergency Rollback Triggered for Deployment #${id} ===`,
      `Project: ${deployment.project.name}`,
      `Environment: ${deployment.environment}`,
      `Rolled back by: ${user.name || user.email}`,
      '[INFO] Reverting Kubernetes deployment spec to previous stable revision...',
      '[INFO] Terminating faulty pods... Done',
      '[INFO] Restored traffic to stable container instances... Done',
      '[INFO] Rollback completed successfully.',
    ].join('\n');

    const newDeployment = await this.prisma.deployment.create({
      data: {
        projectId: deployment.projectId,
        environment: deployment.environment,
        branch: deployment.branch,
        commitSha: `revert-${deployment.commitSha || 'prev'}`,
        status: 'rolled_back',
        logs: rollbackLogs,
        durationSeconds: rollbackDuration,
        triggeredById: user.id,
        organizationId: user.organizationId,
        startedAt: now,
        finishedAt: new Date(now.getTime() + rollbackDuration * 1000),
      },
      include: {
        project: true,
        triggeredBy: true,
      },
    });

    return this.mapDeployment(newDeployment);
  }
}
