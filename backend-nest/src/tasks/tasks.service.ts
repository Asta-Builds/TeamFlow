import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  private isPrivileged(user: any): boolean {
    return (
      user.isStaff ||
      user.isSuperuser ||
      ['ceo', 'tech_lead', 'admin'].includes(user.role)
    );
  }

  private canValidateQa(user: any): boolean {
    return this.isPrivileged(user) || user.role === 'qa';
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

  public mapTask(task: any) {
    return {
      id: task.id,
      project: task.projectId,
      project_name: task.project?.name,
      title: task.title,
      description: task.description,
      status: task.status,
      task_type: task.taskType,
      priority: task.priority,
      assignee: task.assigneeId,
      assignee_detail: this.mapUserSummary(task.assignee),
      created_by: task.createdById,
      created_by_detail: this.mapUserSummary(task.createdBy),
      due_date: task.dueDate ? task.dueDate.toISOString().split('T')[0] : null,
      pr_url: task.prUrl,
      validation_contract: task.validationContract,
      contract_compliance_score: task.contractComplianceScore,
      qa_rejected: task.qaRejected,
      qa_rejection_reason: task.qaRejectionReason,
      order: task.order,
      comments: (task.comments || []).map((c: any) => ({
        id: c.id,
        task: c.taskId,
        author: c.authorId,
        author_detail: this.mapUserSummary(c.author),
        body: c.body,
        created_at: c.createdAt.toISOString(),
      })),
      activities: (task.activities || []).map((a: any) => ({
        id: a.id,
        task: a.taskId,
        actor: a.actorId,
        actor_detail: this.mapUserSummary(a.actor),
        action: a.action,
        details: a.details,
        created_at: a.createdAt.toISOString(),
      })),
      created_at: task.createdAt.toISOString(),
      updated_at: task.updatedAt.toISOString(),
    };
  }

  async findAll(
    currentUser: any,
    query?: {
      project?: number;
      status?: string;
      priority?: string;
      task_type?: string;
      assignee?: number;
      search?: string;
    },
  ) {
    const where: any = {};
    if (currentUser.organizationId) {
      where.organizationId = currentUser.organizationId;
    }

    if (query?.project) {
      where.projectId = query.project;
    }
    if (query?.status) {
      where.status = query.status;
    }
    if (query?.priority) {
      where.priority = query.priority;
    }
    if (query?.task_type) {
      where.taskType = query.task_type;
    }
    if (query?.assignee) {
      where.assigneeId = query.assignee;
    }
    if (query?.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const tasks = await this.prisma.task.findMany({
      where,
      include: {
        project: true,
        assignee: true,
        createdBy: true,
        comments: { include: { author: true }, orderBy: { createdAt: 'asc' } },
        activities: { include: { actor: true }, orderBy: { createdAt: 'desc' } },
      },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    });

    return tasks.map((t) => this.mapTask(t));
  }

  async findOne(id: number, currentUser: any) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: {
        project: true,
        assignee: true,
        createdBy: true,
        comments: { include: { author: true }, orderBy: { createdAt: 'asc' } },
        activities: { include: { actor: true }, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    if (currentUser.organizationId && task.organizationId !== currentUser.organizationId) {
      throw new ForbiddenException('Access denied across tenants');
    }

    return this.mapTask(task);
  }

  async create(dto: CreateTaskDto, currentUser: any) {
    const project = await this.prisma.project.findUnique({ where: { id: dto.project } });
    if (!project) {
      throw new NotFoundException(`Project with ID ${dto.project} not found`);
    }

    const task = await this.prisma.task.create({
      data: {
        projectId: dto.project,
        title: dto.title,
        description: dto.description || '',
        status: dto.status || 'todo',
        taskType: dto.task_type || 'task',
        priority: dto.priority || 'medium',
        assigneeId: dto.assignee ?? null,
        createdById: currentUser.id,
        dueDate: dto.due_date ? new Date(dto.due_date) : null,
        prUrl: dto.pr_url || '',
        validationContract: dto.validation_contract ?? [],
        order: dto.order ?? 0,
        organizationId: currentUser.organizationId,
      },
      include: {
        project: true,
        assignee: true,
        createdBy: true,
      },
    });

    // Log Activity
    await this.prisma.taskActivity.create({
      data: {
        taskId: task.id,
        actorId: currentUser.id,
        action: 'created',
        details: { title: task.title, status: task.status },
      },
    });

    // Notify assignee
    if (task.assigneeId && task.assigneeId !== currentUser.id) {
      await this.prisma.notification.create({
        data: {
          recipientId: task.assigneeId,
          actorId: currentUser.id,
          title: `Ticket assigned: ${task.title}`,
          message: `${currentUser.name || currentUser.email} assigned you to ticket '${task.title}' in ${project.name}.`,
          link: `/projects/${task.projectId}`,
          organizationId: currentUser.organizationId,
        },
      });
    }

    return this.mapTask(task);
  }

  async update(id: number, dto: UpdateTaskDto, currentUser: any) {
    const oldTask = await this.prisma.task.findUnique({
      where: { id },
      include: { project: true, assignee: true },
    });

    if (!oldTask) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    if (currentUser.organizationId && oldTask.organizationId !== currentUser.organizationId) {
      throw new ForbiddenException('Access denied across tenants');
    }

    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.task_type !== undefined) data.taskType = dto.task_type;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.assignee !== undefined) data.assigneeId = dto.assignee;
    if (dto.due_date !== undefined) data.dueDate = dto.due_date ? new Date(dto.due_date) : null;
    if (dto.pr_url !== undefined) data.prUrl = dto.pr_url;
    if (dto.validation_contract !== undefined) data.validationContract = dto.validation_contract;
    if (dto.contract_compliance_score !== undefined) data.contractComplianceScore = dto.contract_compliance_score;
    if (dto.qa_rejected !== undefined) data.qaRejected = dto.qa_rejected;
    if (dto.qa_rejection_reason !== undefined) data.qaRejectionReason = dto.qa_rejection_reason;
    if (dto.order !== undefined) data.order = dto.order;

    const updatedTask = await this.prisma.task.update({
      where: { id },
      data,
      include: {
        project: true,
        assignee: true,
        createdBy: true,
        comments: { include: { author: true } },
        activities: { include: { actor: true } },
      },
    });

    // Handle status change transitions
    if (dto.status && dto.status !== oldTask.status) {
      await this.prisma.taskActivity.create({
        data: {
          taskId: id,
          actorId: currentUser.id,
          action: 'status_changed',
          details: { from: oldTask.status, to: dto.status },
        },
      });

      if (dto.status === 'qa') {
        const qaUsers = await this.prisma.user.findMany({
          where: { organizationId: currentUser.organizationId, role: 'qa' },
        });
        for (const q of qaUsers) {
          await this.prisma.notification.create({
            data: {
              recipientId: q.id,
              actorId: currentUser.id,
              title: `Ticket ready for QA: ${updatedTask.title}`,
              message: `Ticket '${updatedTask.title}' was moved to QA for review.`,
              link: `/projects/${updatedTask.projectId}`,
              organizationId: currentUser.organizationId,
            },
          });
        }
      } else if (dto.status === 'done') {
        if (updatedTask.createdById && updatedTask.createdById !== currentUser.id) {
          await this.prisma.notification.create({
            data: {
              recipientId: updatedTask.createdById,
              actorId: currentUser.id,
              title: `Ticket completed: ${updatedTask.title}`,
              message: `Ticket '${updatedTask.title}' was marked as Done.`,
              link: `/projects/${updatedTask.projectId}`,
              organizationId: currentUser.organizationId,
            },
          });
        }
      }
    }

    // Handle assignee change
    if (dto.assignee !== undefined && dto.assignee !== oldTask.assigneeId) {
      await this.prisma.taskActivity.create({
        data: {
          taskId: id,
          actorId: currentUser.id,
          action: 'assigned',
          details: { assignee: updatedTask.assignee?.email ?? 'None' },
        },
      });

      if (updatedTask.assigneeId && updatedTask.assigneeId !== currentUser.id) {
        await this.prisma.notification.create({
          data: {
            recipientId: updatedTask.assigneeId,
            actorId: currentUser.id,
            title: `Ticket assigned: ${updatedTask.title}`,
            message: `You were assigned to ticket '${updatedTask.title}'.`,
            link: `/projects/${updatedTask.projectId}`,
            organizationId: currentUser.organizationId,
          },
        });
      }
    }

    return this.mapTask(updatedTask);
  }

  async remove(id: number, currentUser: any) {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    if (currentUser.organizationId && task.organizationId !== currentUser.organizationId) {
      throw new ForbiddenException('Access denied across tenants');
    }

    await this.prisma.task.delete({ where: { id } });
    return { success: true, message: `Task #${id} deleted` };
  }

  async qaValidate(id: number, currentUser: any) {
    if (!this.canValidateQa(currentUser)) {
      throw new ForbiddenException('Only QA Engineer, Tech Lead or CEO can validate QA');
    }

    const task = await this.prisma.task.update({
      where: { id },
      data: {
        status: 'done',
        qaRejected: false,
        qaRejectionReason: '',
      },
      include: { project: true, assignee: true, createdBy: true },
    });

    await this.prisma.taskActivity.create({
      data: {
        taskId: id,
        actorId: currentUser.id,
        action: 'qa_validated',
        details: { note: 'QA passed and ticket closed' },
      },
    });

    if (task.assigneeId && task.assigneeId !== currentUser.id) {
      await this.prisma.notification.create({
        data: {
          recipientId: task.assigneeId,
          actorId: currentUser.id,
          title: `QA Approved: ${task.title}`,
          message: `QA verified ticket '${task.title}'. Ticket is now Done.`,
          link: `/projects/${task.projectId}`,
          organizationId: currentUser.organizationId,
        },
      });
    }

    return this.mapTask(task);
  }

  async qaReject(id: number, reason: string, currentUser: any) {
    if (!this.canValidateQa(currentUser)) {
      throw new ForbiddenException('Only QA Engineer, Tech Lead or CEO can reject QA');
    }

    if (!reason || !reason.trim()) {
      throw new BadRequestException('A rejection explanation is mandatory.');
    }

    const task = await this.prisma.task.update({
      where: { id },
      data: {
        status: 'in_progress',
        qaRejected: true,
        qaRejectionReason: reason.trim(),
      },
      include: { project: true, assignee: true, createdBy: true },
    });

    await this.prisma.comment.create({
      data: {
        taskId: id,
        authorId: currentUser.id,
        body: `❌ QA Rejected: ${reason.trim()}`,
      },
    });

    await this.prisma.taskActivity.create({
      data: {
        taskId: id,
        actorId: currentUser.id,
        action: 'qa_rejected',
        details: { reason: reason.trim() },
      },
    });

    if (task.assigneeId && task.assigneeId !== currentUser.id) {
      await this.prisma.notification.create({
        data: {
          recipientId: task.assigneeId,
          actorId: currentUser.id,
          title: `QA Rejected: ${task.title}`,
          message: `Ticket '${task.title}' failed QA review: ${reason.trim()}`,
          link: `/projects/${task.projectId}`,
          organizationId: currentUser.organizationId,
        },
      });
    }

    return this.mapTask(task);
  }

  async addComment(taskId: number, body: string, currentUser: any) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { project: true },
    });
    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    const comment = await this.prisma.comment.create({
      data: {
        taskId,
        authorId: currentUser.id,
        body,
      },
      include: { author: true },
    });

    await this.prisma.taskActivity.create({
      data: {
        taskId,
        actorId: currentUser.id,
        action: 'commented',
        details: { comment_preview: body.slice(0, 100) },
      },
    });

    // Notify assignee & creator
    const recipientIds = new Set<number>();
    if (task.assigneeId && task.assigneeId !== currentUser.id) {
      recipientIds.add(task.assigneeId);
    }
    if (task.createdById && task.createdById !== currentUser.id) {
      recipientIds.add(task.createdById);
    }

    for (const rid of recipientIds) {
      await this.prisma.notification.create({
        data: {
          recipientId: rid,
          actorId: currentUser.id,
          title: `New comment on: ${task.title}`,
          message: `${currentUser.name || currentUser.email} commented: ${body.slice(0, 80)}`,
          link: `/projects/${task.projectId}`,
          organizationId: currentUser.organizationId,
        },
      });
    }

    return {
      id: comment.id,
      task: comment.taskId,
      author: comment.authorId,
      author_detail: this.mapUserSummary(comment.author),
      body: comment.body,
      created_at: comment.createdAt.toISOString(),
    };
  }

  async getMyTasks(currentUser: any) {
    const tasks = await this.prisma.task.findMany({
      where: {
        organizationId: currentUser.organizationId,
        assigneeId: currentUser.id,
      },
      include: {
        project: true,
        assignee: true,
        createdBy: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return tasks.map((t) => this.mapTask(t));
  }

  async getFeed(currentUser: any) {
    const activities = await this.prisma.taskActivity.findMany({
      where: {
        task: { organizationId: currentUser.organizationId },
      },
      include: {
        actor: true,
        task: { include: { project: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    return activities.map((a) => ({
      id: a.id,
      task: a.taskId,
      task_title: a.task?.title,
      project_name: a.task?.project?.name,
      actor: a.actorId,
      actor_detail: this.mapUserSummary(a.actor),
      action: a.action,
      details: a.details,
      created_at: a.createdAt.toISOString(),
    }));
  }

  async getComments(taskId?: number) {
    const where: any = {};
    if (taskId) where.taskId = taskId;

    const comments = await this.prisma.comment.findMany({
      where,
      include: { author: true },
      orderBy: { createdAt: 'asc' },
    });

    return comments.map((c) => ({
      id: c.id,
      task: c.taskId,
      author: c.authorId,
      author_detail: this.mapUserSummary(c.author),
      body: c.body,
      created_at: c.createdAt.toISOString(),
    }));
  }
}
