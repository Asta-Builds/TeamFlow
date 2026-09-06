import { requireTenantUsers } from '../common/access.js';
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';

@Injectable()
export class ProjectsService {
  private readonly pythonAiUrl =
    process.env.PYTHON_AI_SERVICE_URL || 'http://127.0.0.1:8000';

  constructor(
    private prisma: PrismaService,
    @Optional() private httpService?: HttpService,
  ) {}

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

  private getBridgeToken(user: any): string | null {
    try {
      const secret = process.env.PYTHON_AI_JWT_SECRET;
      if (!secret || secret.length < 32) return null;
      return new JwtService().sign(
        {
          user_id: user.id,
          token_type: 'access',
          jti: randomUUID(),
        },
        {
          secret,
          algorithm: 'HS256',
          expiresIn: '60s',
        },
      );
    } catch {
      return null;
    }
  }

  private async getOrCreateAgentUser(
    agentKey: string,
    organizationId: number,
    defaultName: string,
    defaultEmail: string,
    defaultRole: string,
  ) {
    let user = await this.prisma.user.findFirst({
      where: { agentKey, organizationId },
    });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: `${agentKey}-${organizationId}@teamflow.dev`,
          name: defaultName,
          role: defaultRole,
          agentKey,
          organizationId,
          password: 'pbkdf2_sha256$870000$disabled$agentpassword',
          userStatus: 'active',
          isActive: true,
        },
      });
    }
    return user;
  }

  async pmGenerateTasks(projectId: number, planText: string, currentUser: any) {
    const cleanPlan = planText.trim();
    if (!cleanPlan) {
      throw new BadRequestException('A plan or feature prompt is required.');
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { members: true },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    const orgId = project.organizationId;
    if (
      !orgId ||
      !currentUser.organizationId ||
      orgId !== currentUser.organizationId
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

    // 1. Try forwarding to Python AI service
    const bridgeToken = this.getBridgeToken(currentUser);
    if (this.httpService && bridgeToken) {
      try {
        const response = await this.httpService.axiosRef.post(
          `${this.pythonAiUrl}/api/projects/${projectId}/pm_generate_tasks/`,
          { plan: cleanPlan },
          {
            headers: { Authorization: `Bearer ${bridgeToken}` },
            timeout: 15000,
          },
        );
        if (response.data && response.data.ok) {
          return response.data;
        }
      } catch {
        // Fall back to native Prisma decomposition
      }
    }

    // 2. Native Prisma decomposition fallback
    const summaryTitle =
      cleanPlan
        .split('\n')[0]
        .replace(/^[#\s@pm]+/g, '')
        .trim()
        .slice(0, 80) || project.name;

    const pmUser = await this.getOrCreateAgentUser(
      'pm',
      orgId,
      'Athena (AI)',
      'pm@teamflow.dev',
      'pm',
    );
    const backendUser = await this.getOrCreateAgentUser(
      'backend_core',
      orgId,
      'Marcus Aurelius (AI)',
      'backend1@teamflow.dev',
      'backend',
    );
    const frontendUser = await this.getOrCreateAgentUser(
      'frontend_app',
      orgId,
      'Cleopatra (AI)',
      'frontend1@teamflow.dev',
      'frontend',
    );
    const qaUser = await this.getOrCreateAgentUser(
      'qa',
      orgId,
      'Alan Turing (AI)',
      'qa@teamflow.dev',
      'qa',
    );

    const ticketSpecs = [
      {
        title: `[Backend] API Endpoints & Data Model for ${summaryTitle}`,
        taskType: 'feature',
        priority: 'high',
        assigneeId: backendUser.id,
        description: `**Feature Scope:** ${summaryTitle}\n\n**Requirements from PM Plan:**\n${cleanPlan}\n\n**Deliverables:**\n- Database models with validation\n- REST endpoints with error handling\n- Mutex concurrency locks\n- Open GitHub PR on \`${project.githubRepo}\``,
        dialogue: [
          {
            authorId: pmUser.id,
            text: `Hey @${backendUser.name.split(' ')[0]}! Here are the backend specs for **${summaryTitle}**. Let me know if you need clarification on the schema.`,
          },
          {
            authorId: backendUser.id,
            text: `Thanks @${pmUser.name.split(' ')[0]}! I've reviewed the requirements and architectural context. I'll scaffold the models, serializer schemas, and open the PR shortly.`,
          },
        ],
      },
      {
        title: `[Frontend] Next.js Views & State Management for ${summaryTitle}`,
        taskType: 'feature',
        priority: 'high',
        assigneeId: frontendUser.id,
        description: `**Feature Scope:** ${summaryTitle}\n\n**UI/UX Requirements:**\n- SuperDesign dark theme (bg-slate-950, border-slate-800)\n- Lucide React vector icons (strictly zero raw emojis)\n- Sonner toasts for interactive user feedback\n- Responsive layout adhering to WCAG 2.1 AA contrast`,
        dialogue: [
          {
            authorId: pmUser.id,
            text: `Hi @${frontendUser.name.split(' ')[0]}, here are the client UI requirements for **${summaryTitle}**. Make sure to follow the SuperDesign theme guidelines.`,
          },
          {
            authorId: frontendUser.id,
            text: `On it @${pmUser.name.split(' ')[0]}! I'll build the Next.js 16 App Router components using Lucide icons, responsive drawer modals, and optimistic toast feedback.`,
          },
        ],
      },
      {
        title: `[QA] Automated Integration & Regression Suite for ${summaryTitle}`,
        taskType: 'task',
        priority: 'medium',
        assigneeId: qaUser.id,
        description: `**Testing Criteria:**\n- Concurrency load harness (>50 req/s)\n- Boundary and edge condition validation\n- 5-stage Kanban decision gate validation`,
        dialogue: [
          {
            authorId: pmUser.id,
            text: `Hey @${qaUser.name.split(' ')[0]}, please prepare test cases and validation scripts for **${summaryTitle}**.`,
          },
          {
            authorId: qaUser.id,
            text: `Confirmed @${pmUser.name.split(' ')[0]}. I'll set up automated integration tests and monitor the staging build before certifying the gate.`,
          },
        ],
      },
    ];

    const createdTasks = [];
    for (const spec of ticketSpecs) {
      const task = await this.prisma.task.create({
        data: {
          title: spec.title,
          description: spec.description,
          taskType: spec.taskType,
          priority: spec.priority,
          status: 'todo',
          projectId,
          organizationId: orgId,
          createdById: pmUser.id,
          assigneeId: spec.assigneeId,
          comments: {
            create: spec.dialogue.map((d) => ({
              body: d.text,
              authorId: d.authorId,
            })),
          },
          activities: {
            create: {
              action: 'created_task',
              actorId: pmUser.id,
              details: {
                source: 'pm_agent_plan_decomposition',
                plan_snippet: cleanPlan.slice(0, 100),
              },
            },
          },
        },
        include: {
          assignee: true,
          createdBy: true,
          project: { select: { name: true } },
          comments: { include: { author: true } },
        },
      });
      createdTasks.push(task);
    }

    // Create Notification for user
    if (currentUser && currentUser.id !== pmUser.id) {
      await this.prisma.notification.create({
        data: {
          recipientId: currentUser.id,
          actorId: pmUser.id,
          title: `PM Agent (${pmUser.name}) Decomposed Your Plan`,
          message: `Created ${createdTasks.length} engineering tickets and assigned them to specialist AI agents.`,
          link: `/projects/${projectId}`,
          organizationId: orgId,
        },
      });
    }

    const mappedTasks = createdTasks.map((t) => ({
      id: t.id,
      project: t.projectId,
      project_name: t.project?.name,
      title: t.title,
      description: t.description,
      status: t.status,
      task_type: t.taskType,
      priority: t.priority,
      assignee: t.assigneeId,
      assignee_detail: this.mapUserSummary(t.assignee),
      created_by: t.createdById,
      created_by_detail: this.mapUserSummary(t.createdBy),
      due_date: null,
      pr_url: '',
      validation_contract: [],
      contract_compliance_score: 0.0,
      qa_rejected: false,
      qa_rejection_reason: '',
      order: 0,
      comments: (t.comments || []).map((c: any) => ({
        id: c.id,
        task: c.taskId,
        author: c.authorId,
        author_detail: this.mapUserSummary(c.author),
        body: c.body,
        created_at: c.createdAt.toISOString(),
      })),
      created_at: t.createdAt.toISOString(),
      updated_at: t.updatedAt.toISOString(),
    }));

    return {
      ok: true,
      project_id: projectId,
      tasks_created_count: createdTasks.length,
      pm_summary: `**Athena (AI PM):** Decomposed plan into **${createdTasks.length} sprint tickets**.\n- Assigned Backend to **${backendUser.name}**\n- Assigned Frontend to **${frontendUser.name}**\n- Assigned QA to **${qaUser.name}**\nAll agents have acknowledged receipt in ticket comments.`,
      tasks_data: mappedTasks,
    };
  }
}
