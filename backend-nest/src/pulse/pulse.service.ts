import { requireOrganization, visibleTasks } from '../common/access.js';
import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreatePlanItemDto,
  UpdateNoteDto,
  StartFocusSessionDto,
} from './dto/pulse.dto.js';

function parseDateOnly(dateStr?: string): Date {
  if (!dateStr) {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
  }
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  }
  const d = new Date(dateStr);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0),
  );
}

function formatDateOnly(d: Date | string): string {
  if (typeof d === 'string') {
    return d.split('T')[0];
  }
  return d.toISOString().split('T')[0];
}

@Injectable()
export class PulseService {
  constructor(private prisma: PrismaService) {}

  private computeElapsed(session: any, now = new Date()): number {
    let elapsed = session.elapsedSeconds ?? 0;
    if (session.status === 'active' && session.lastResumedAt) {
      const diffSec = Math.max(
        0,
        Math.floor(
          (now.getTime() - new Date(session.lastResumedAt).getTime()) / 1000,
        ),
      );
      elapsed += diffSec;
    }
    return elapsed;
  }

  private mapSession(session: any) {
    if (!session) return null;
    const isRunning = session.status === 'active' && session.lastResumedAt;
    return {
      id: session.id,
      plan_item: session.planItemId,
      task_title: session.planItem?.task?.title || null,
      project_name: session.planItem?.task?.project?.name || null,
      status: session.status,
      started_at: session.startedAt.toISOString(),
      running_since: isRunning
        ? session.lastResumedAt.toISOString()
        : null,
      last_resumed_at: session.lastResumedAt
        ? session.lastResumedAt.toISOString()
        : null,
      elapsed_seconds: this.computeElapsed(session),
      ended_at: session.endedAt ? session.endedAt.toISOString() : null,
      created_at: session.createdAt.toISOString(),
      updated_at: session.updatedAt.toISOString(),
      plan_item_detail: session.planItem
        ? {
            id: session.planItem.id,
            task: session.planItem.taskId,
            task_title: session.planItem.task?.title,
            project_name: session.planItem.task?.project?.name,
          }
        : null,
    };
  }

  private formatPlanItem(item: any, user: any) {
    const isDone = item.task.status === 'done';
    const canComplete =
      !isDone &&
      (Boolean(user.isPrivileged) ||
        item.task.assigneeId === user.id ||
        item.task.createdById === user.id);

    return {
      id: item.id,
      task: item.taskId,
      task_title: item.task.title,
      project_id: item.task.projectId,
      project_name: item.task.project?.name || '',
      task_status: item.task.status,
      task_priority: item.task.priority,
      task_type: item.task.taskType || 'task',
      due_date: item.task.dueDate ? formatDateOnly(item.task.dueDate) : null,
      date: formatDateOnly(item.date),
      time_block: item.timeBlock,
      position: item.position,
      can_complete_task: canComplete,
      created_at: item.createdAt.toISOString(),
      updated_at: item.updatedAt.toISOString(),
      task_detail: {
        id: item.task.id,
        title: item.task.title,
        status: item.task.status,
        priority: item.task.priority,
        project_name: item.task.project?.name,
      },
    };
  }

  async getDashboard(user: any, dateStr?: string) {
    requireOrganization(user);
    const targetDate = parseDateOnly(dateStr);
    const targetDateStr = formatDateOnly(targetDate);

    const organizationId = user.organizationId;
    if (!organizationId) {
      throw new BadRequestException('Organization is required');
    }

    // 1. Plan items for date
    const planItems = await this.prisma.pulsePlanItem.findMany({
      where: {
        userId: user.id,
        organizationId,
        date: targetDate,
      },
      include: {
        task: {
          include: {
            project: true,
            assignee: true,
            createdBy: true,
          },
        },
      },
      orderBy: [
        { timeBlock: 'asc' },
        { position: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    const plannedTaskIds = planItems.map((p) => p.taskId);

    // 2. Candidate tasks: open tasks in organization visible to user, not yet planned
    const candidateTasks = await this.prisma.task.findMany({
      where: {
        ...visibleTasks(user),
        organizationId,
        status: { not: 'done' },
        id: { notIn: plannedTaskIds.length ? plannedTaskIds : [-1] },
        OR: [
          { assigneeId: user.id },
          { createdById: user.id },
          { dueDate: targetDate },
        ],
      },
      include: {
        project: true,
      },
      orderBy: [
        { dueDate: 'asc' },
        { priority: 'asc' },
        { createdAt: 'desc' },
      ],
      take: 12,
    });

    // 3. Note for date
    const note = await this.prisma.pulseNote.findFirst({
      where: {
        userId: user.id,
        organizationId,
        date: targetDate,
      },
    });

    // 4. Active / paused focus session
    const activeSession = await this.prisma.pulseFocusSession.findFirst({
      where: {
        userId: user.id,
        organizationId,
        status: { in: ['active', 'paused'] },
      },
      include: {
        planItem: {
          include: { task: { include: { project: true } } },
        },
      },
    });

    // 5. Total focus seconds today
    const nextDay = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
    const sessionsToday = await this.prisma.pulseFocusSession.findMany({
      where: {
        userId: user.id,
        organizationId,
        startedAt: { gte: targetDate, lt: nextDay },
      },
    });

    let totalSecondsToday = sessionsToday.reduce(
      (acc, s) => acc + this.computeElapsed(s),
      0,
    );
    if (activeSession && !sessionsToday.some((s) => s.id === activeSession.id)) {
      totalSecondsToday += this.computeElapsed(activeSession);
    }

    // 6. Weekly progress (7 days ending on targetDate)
    const weekStart = new Date(targetDate.getTime() - 6 * 24 * 60 * 60 * 1000);
    const weeklyPlanItems = await this.prisma.pulsePlanItem.findMany({
      where: {
        userId: user.id,
        organizationId,
        date: { gte: weekStart, lte: targetDate },
      },
      include: {
        task: true,
      },
    });

    const weeklyProgress: Array<{ date: string; total: number; completed: number }> = [];
    for (let offset = 0; offset < 7; offset++) {
      const d = new Date(weekStart.getTime() + offset * 24 * 60 * 60 * 1000);
      const dStr = formatDateOnly(d);
      const itemsForDay = weeklyPlanItems.filter(
        (item) => formatDateOnly(item.date) === dStr,
      );
      weeklyProgress.push({
        date: dStr,
        total: itemsForDay.length,
        completed: itemsForDay.filter((item) => item.task.status === 'done').length,
      });
    }

    const totalPlanned = planItems.length;
    const totalCompleted = planItems.filter((i) => i.task.status === 'done').length;

    const formattedPlanItems = planItems.map((item) =>
      this.formatPlanItem(item, user),
    );

    const formattedSession = this.mapSession(activeSession);

    return {
      date: targetDateStr,
      selected_date: targetDateStr,
      plan_items: formattedPlanItems,
      candidate_tasks: candidateTasks.map((t) => ({
        id: t.id,
        title: t.title,
        project_id: t.projectId,
        project_name: t.project.name,
        priority: t.priority,
        status: t.status,
        due_date: t.dueDate ? formatDateOnly(t.dueDate) : null,
      })),
      note: {
        id: note?.id,
        date: targetDateStr,
        body: note?.body || '',
        created_at: note?.createdAt.toISOString(),
        updated_at: note?.updatedAt.toISOString(),
      },
      current_session: formattedSession,
      active_session: formattedSession,
      summary: {
        planned: totalPlanned,
        completed: totalCompleted,
        completion_percentage:
          totalPlanned > 0 ? Math.round((totalCompleted / totalPlanned) * 100) : 0,
        focused_seconds: totalSecondsToday,
      },
      stats: {
        focus_minutes_today: Math.round(totalSecondsToday / 60),
        total_sessions_today: sessionsToday.length,
        completed_plan_items: totalCompleted,
      },
      weekly_progress: weeklyProgress,
    };
  }

  async getNote(user: any, dateStr?: string) {
    requireOrganization(user);
    const targetDate = parseDateOnly(dateStr);
    const targetDateStr = formatDateOnly(targetDate);

    const note = await this.prisma.pulseNote.findFirst({
      where: {
        userId: user.id,
        organizationId: user.organizationId,
        date: targetDate,
      },
    });

    return {
      id: note?.id,
      date: targetDateStr,
      body: note?.body || '',
      created_at: note?.createdAt.toISOString(),
      updated_at: note?.updatedAt.toISOString(),
    };
  }

  async updateNote(user: any, dto: UpdateNoteDto) {
    requireOrganization(user);
    const targetDate = parseDateOnly(dto.date);

    const note = await this.prisma.pulseNote.upsert({
      where: {
        pulse_unique_daily_note_per_user: {
          userId: user.id,
          date: targetDate,
        },
      },
      update: {
        body: dto.body,
      },
      create: {
        userId: user.id,
        organizationId: user.organizationId,
        date: targetDate,
        body: dto.body,
      },
    });

    return {
      id: note.id,
      date: formatDateOnly(note.date),
      body: note.body,
      created_at: note.createdAt.toISOString(),
      updated_at: note.updatedAt.toISOString(),
    };
  }

  async getPlanItems(user: any, dateStr?: string) {
    requireOrganization(user);
    const targetDate = parseDateOnly(dateStr);

    const items = await this.prisma.pulsePlanItem.findMany({
      where: {
        userId: user.id,
        organizationId: user.organizationId,
        date: targetDate,
      },
      include: {
        task: {
          include: { project: true, assignee: true, createdBy: true },
        },
      },
      orderBy: [{ timeBlock: 'asc' }, { position: 'asc' }],
    });

    return items.map((item) => this.formatPlanItem(item, user));
  }

  async createPlanItem(user: any, dto: CreatePlanItemDto) {
    requireOrganization(user);
    const task = await this.prisma.task.findFirst({
      where: { id: dto.task, ...visibleTasks(user) },
      include: { project: true, assignee: true, createdBy: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    const targetDate = parseDateOnly(dto.date);

    const existing = await this.prisma.pulsePlanItem.findUnique({
      where: {
        pulse_unique_daily_task_per_user: {
          userId: user.id,
          date: targetDate,
          taskId: dto.task,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        'This task is already in your plan for that day.',
      );
    }

    const item = await this.prisma.pulsePlanItem.create({
      data: {
        userId: user.id,
        organizationId: user.organizationId,
        taskId: dto.task,
        date: targetDate,
        timeBlock: dto.time_block || 'morning',
        position: dto.position || 0,
      },
      include: {
        task: {
          include: { project: true, assignee: true, createdBy: true },
        },
      },
    });

    return this.formatPlanItem(item, user);
  }

  async deletePlanItem(user: any, id: number) {
    requireOrganization(user);
    const item = await this.prisma.pulsePlanItem.findUnique({ where: { id } });
    if (
      !item ||
      item.userId !== user.id ||
      item.organizationId !== user.organizationId
    ) {
      throw new NotFoundException(`Plan item #${id} not found`);
    }

    await this.prisma.pulsePlanItem.delete({ where: { id } });
    return { success: true };
  }

  async startFocusSession(user: any, dto: StartFocusSessionDto) {
    requireOrganization(user);
    if (dto.plan_item != null) {
      const item = await this.prisma.pulsePlanItem.findFirst({
        where: {
          id: dto.plan_item,
          userId: user.id,
          organizationId: user.organizationId,
          task: visibleTasks(user),
        },
      });
      if (!item) throw new NotFoundException('Plan item not found');
    }
    const active = await this.prisma.pulseFocusSession.findFirst({
      where: {
        userId: user.id,
        status: { in: ['active', 'paused'] },
      },
    });

    if (active) {
      throw new ConflictException(
        'Finish or resume your existing focus session first.',
      );
    }

    const now = new Date();
    const session = await this.prisma.pulseFocusSession.create({
      data: {
        userId: user.id,
        organizationId: user.organizationId,
        planItemId: dto.plan_item ?? null,
        status: 'active',
        startedAt: now,
        lastResumedAt: now,
      },
      include: {
        planItem: { include: { task: { include: { project: true } } } },
      },
    });

    return this.mapSession(session);
  }

  async pauseFocusSession(user: any, id: number) {
    requireOrganization(user);
    const session = await this.prisma.pulseFocusSession.findUnique({
      where: { id },
      include: {
        planItem: { include: { task: { include: { project: true } } } },
      },
    });

    if (
      !session ||
      session.userId !== user.id ||
      session.organizationId !== user.organizationId
    ) {
      throw new NotFoundException(`Session #${id} not found`);
    }

    if (session.status !== 'active') {
      throw new ConflictException(
        'Only an active focus session can be paused.',
      );
    }

    const elapsed = this.computeElapsed(session);
    const updated = await this.prisma.pulseFocusSession.update({
      where: { id },
      data: {
        status: 'paused',
        elapsedSeconds: elapsed,
        lastResumedAt: null,
      },
      include: {
        planItem: { include: { task: { include: { project: true } } } },
      },
    });

    return this.mapSession(updated);
  }

  async resumeFocusSession(user: any, id: number) {
    requireOrganization(user);
    const session = await this.prisma.pulseFocusSession.findUnique({
      where: { id },
      include: {
        planItem: { include: { task: { include: { project: true } } } },
      },
    });

    if (
      !session ||
      session.userId !== user.id ||
      session.organizationId !== user.organizationId
    ) {
      throw new NotFoundException(`Session #${id} not found`);
    }

    if (session.status !== 'paused') {
      throw new ConflictException(
        'Only a paused focus session can be resumed.',
      );
    }

    const updated = await this.prisma.pulseFocusSession.update({
      where: { id },
      data: {
        status: 'active',
        lastResumedAt: new Date(),
      },
      include: {
        planItem: { include: { task: { include: { project: true } } } },
      },
    });

    return this.mapSession(updated);
  }

  async completeFocusSession(user: any, id: number) {
    requireOrganization(user);
    const session = await this.prisma.pulseFocusSession.findUnique({
      where: { id },
      include: {
        planItem: { include: { task: { include: { project: true } } } },
      },
    });

    if (
      !session ||
      session.userId !== user.id ||
      session.organizationId !== user.organizationId
    ) {
      throw new NotFoundException(`Session #${id} not found`);
    }

    if (session.status === 'completed') {
      throw new ConflictException('This focus session is already completed.');
    }

    const now = new Date();
    const elapsed = this.computeElapsed(session, now);

    const updated = await this.prisma.pulseFocusSession.update({
      where: { id },
      data: {
        status: 'completed',
        elapsedSeconds: elapsed,
        lastResumedAt: null,
        endedAt: now,
      },
      include: {
        planItem: { include: { task: { include: { project: true } } } },
      },
    });

    return this.mapSession(updated);
  }
}
