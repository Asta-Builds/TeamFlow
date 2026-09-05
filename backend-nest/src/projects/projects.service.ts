import { requireTenantUsers } from '../common/access.js';
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  private isPrivileged(user: any): boolean {
    return (
      user.isStaff ||
      user.isSuperuser ||
      ['ceo', 'tech_lead', 'admin'].includes(user.role)
    );
  }

  private mapUserSummary(user: any) {
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      agent_key: user.agentKey,
      is_ai_agent: Boolean(user.agentKey),
      avatar_url: user.avatarUrl,
    };
  }

  private mapProject(project: any) {
    const totalTasks = project.tasks?.length ?? 0;
    const doneTasks =
      project.tasks?.filter((t: any) => t.status === 'done').length ?? 0;
    const progress =
      totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

    const memberIds =
      project.members?.map((m: any) => m.userId ?? m.user?.id) ?? [];
    const membersDetail =
      project.members?.map((m: any) => this.mapUserSummary(m.user)) ?? [];

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      github_repo: project.githubRepo,
      owner: project.ownerId,
      owner_detail: this.mapUserSummary(project.owner),
      members: memberIds,
      members_detail: membersDetail,
      task_count: totalTasks,
      done_task_count: doneTasks,
      progress_percentage: progress,
      created_at: project.createdAt.toISOString(),
      updated_at: project.updatedAt.toISOString(),
    };
  }

  async findAll(
    currentUser: any,
    query?: { status?: string; search?: string },
  ) {
    if (!currentUser.organizationId) return [];
    const where: any = {};
    if (currentUser.organizationId) {
      where.organizationId = currentUser.organizationId;
    }

    if (!this.isPrivileged(currentUser)) {
      where.OR = [
        { ownerId: currentUser.id },
        { members: { some: { userId: currentUser.id } } },
      ];
    }

    if (query?.status) {
      where.status = query.status;
    }

    if (query?.search) {
      where.AND = [
        {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const projects = await this.prisma.project.findMany({
      where,
      include: {
        owner: true,
        members: { include: { user: true } },
        tasks: { select: { id: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return projects.map((p) => this.mapProject(p));
  }

  async findOne(id: number, currentUser: any) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        owner: true,
        members: { include: { user: true } },
        tasks: { select: { id: true, status: true } },
      },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    if (
      !currentUser.organizationId ||
      project.organizationId !== currentUser.organizationId
    ) {
      throw new ForbiddenException('Access denied across tenants');
    }

    if (
      !this.isPrivileged(currentUser) &&
      project.ownerId !== currentUser.id &&
      !project.members.some((m) => m.userId === currentUser.id)
    ) {
      throw new ForbiddenException('You are not a member of this project');
    }

    return this.mapProject(project);
  }

  async create(dto: CreateProjectDto, currentUser: any) {
    if (!currentUser.organizationId)
      throw new ForbiddenException('An organization is required');
    if (!this.isPrivileged(currentUser)) {
      throw new ForbiddenException(
        'Only Tech Lead, CEO or Admin can create projects',
      );
    }

    await requireTenantUsers(this.prisma, dto.members ?? [], currentUser);
    const project = await this.prisma.project.create({
      data: {
        name: dto.name,
        description: dto.description || '',
        status: dto.status || 'active',
        githubRepo: dto.github_repo || 'Asta-Builds/TeamFlow',
        ownerId: currentUser.id,
        organizationId: currentUser.organizationId,
        members: dto.members?.length
          ? {
              create: [...new Set(dto.members)].map((userId) => ({ userId })),
            }
          : undefined,
      },
      include: {
        owner: true,
        members: { include: { user: true } },
        tasks: { select: { id: true, status: true } },
      },
    });

    return this.mapProject(project);
  }

  async update(id: number, dto: UpdateProjectDto, currentUser: any) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { members: true },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    if (
      !currentUser.organizationId ||
      project.organizationId !== currentUser.organizationId
    ) {
      throw new ForbiddenException('Access denied across tenants');
    }

    if (!this.isPrivileged(currentUser) && project.ownerId !== currentUser.id) {
      throw new ForbiddenException(
        'Only owner or privileged users can edit this project',
      );
    }

    if (dto.members)
      await requireTenantUsers(this.prisma, dto.members, currentUser);

    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        ...(dto.members !== undefined && {
          members: {
            deleteMany: {},
            create: [...new Set(dto.members)].map((userId) => ({ userId })),
          },
        }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.github_repo !== undefined && { githubRepo: dto.github_repo }),
      },
      include: {
        owner: true,
        members: { include: { user: true } },
        tasks: { select: { id: true, status: true } },
      },
    });

    return this.mapProject(updated);
  }

  async remove(id: number, currentUser: any) {
    if (!this.isPrivileged(currentUser)) {
      throw new ForbiddenException(
        'Only Tech Lead, CEO or Admin can delete projects',
      );
    }

    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    if (
      !currentUser.organizationId ||
      project.organizationId !== currentUser.organizationId
    ) {
      throw new ForbiddenException('Access denied across tenants');
    }

    await this.prisma.project.delete({ where: { id } });
    return { success: true, message: `Project #${id} deleted` };
  }
}
