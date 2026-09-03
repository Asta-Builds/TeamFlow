import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePlanItemDto, UpdateNoteDto, StartFocusSessionDto } from './dto/pulse.dto.js';

@Injectable()
export class PulseService {
  constructor(private prisma: PrismaService) {}

  private computeElapsed(session: any, now = new Date()): number {
    let elapsed = session.elapsedSeconds ?? 0;
    if (session.status === 'active' && session.lastResumedAt) {
      const diffSec = Math.max(0, Math.floor((now.getTime() - new Date(session.lastResumedAt).getTime()) / 1000));
      elapsed += diffSec;
    }
    return elapsed;
  }

  private mapSession(session: any) {
    if (!session) return null;
    return {
      id: session.id,
      status: session.status,
      started_at: session.startedAt.toISOString(),
      last_resumed_at: session.lastResumedAt ? session.lastResumedAt.toISOString() : null,
      elapsed_seconds: this.computeElapsed(session),
      ended_at: session.endedAt ? session.endedAt.toISOString() : null,
      plan_item: session.planItemId,
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

  async getDashboard(user: any, dateStr?: string) {
    const targetDate = dateStr ? new Date(dateStr) : new Date();
    targetDate.setHours(0, 0, 0, 0);

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
          },
        },
      },
      orderBy: [{ timeBlock: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
    });

    // 2. Note for date
    const note = await this.prisma.pulseNote.findFirst({
      where: {
        userId: user.id,
        organizationId,
        date: targetDate,
      },
    });

    // 3. Active / paused focus session
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

    // 4. Total focus seconds today
    const sessionsToday = await this.prisma.pulseFocusSession.findMany({
      where: {
        userId: user.id,
        organizationId,
        startedAt: { gte: targetDate },
      },
    });

    const totalSecondsToday = sessionsToday.reduce(
      (acc, s) => acc + this.computeElapsed(s),
      0,
    );

    return {
      selected_date: targetDate.toISOString().split('T')[0],
      plan_items: planItems.map((item) => ({
        id: item.id,
        task: item.taskId,
        date: item.date.toISOString().split('T')[0],
        time_block: item.timeBlock,
        position: item.position,
        task_detail: {
          id: item.task.id,
          title: item.task.title,
          status: item.task.status,
          priority: item.task.priority,
          project_name: item.task.project?.name,
        },
      })),
      note: {
        date: targetDate.toISOString().split('T')[0],
        body: note?.body || '',
      },
      active_session: this.mapSession(activeSession),
      stats: {
        focus_minutes_today: Math.round(totalSecondsToday / 60),
        total_sessions_today: sessionsToday.length,
        completed_plan_items: planItems.filter((i) => i.task.status === 'done').length,
      },
    };
  }

  async getNote(user: any, dateStr?: string) {
    const targetDate = dateStr ? new Date(dateStr) : new Date();
    targetDate.setHours(0, 0, 0, 0);

    const note = await this.prisma.pulseNote.findFirst({
      where: {
        userId: user.id,
        organizationId: user.organizationId,
        date: targetDate,
      },
    });

    return {
      date: targetDate.toISOString().split('T')[0],
      body: note?.body || '',
    };
  }

  async updateNote(user: any, dto: UpdateNoteDto) {
    const targetDate = dto.date ? new Date(dto.date) : new Date();
    targetDate.setHours(0, 0, 0, 0);

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
      date: note.date.toISOString().split('T')[0],
      body: note.body,
    };
  }

  async getPlanItems(user: any, dateStr?: string) {
    const targetDate = dateStr ? new Date(dateStr) : new Date();
    targetDate.setHours(0, 0, 0, 0);

    const items = await this.prisma.pulsePlanItem.findMany({
      where: {
        userId: user.id,
        organizationId: user.organizationId,
        date: targetDate,
      },
      include: {
        task: {
          include: { project: true },
        },
      },
      orderBy: [{ timeBlock: 'asc' }, { position: 'asc' }],
    });

    return items.map((item) => ({
      id: item.id,
      task: item.taskId,
      date: item.date.toISOString().split('T')[0],
      time_block: item.timeBlock,
      position: item.position,
      task_detail: {
        id: item.task.id,
        title: item.task.title,
        status: item.task.status,
        project_name: item.task.project?.name,
      },
    }));
  }

  async createPlanItem(user: any, dto: CreatePlanItemDto) {
    const targetDate = new Date(dto.date);
    targetDate.setHours(0, 0, 0, 0);

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
        task: { include: { project: true } },
      },
    });

    return {
      id: item.id,
      task: item.taskId,
      date: item.date.toISOString().split('T')[0],
      time_block: item.timeBlock,
      position: item.position,
      task_detail: {
        id: item.task.id,
        title: item.task.title,
        status: item.task.status,
        project_name: item.task.project?.name,
      },
    };
  }

  async deletePlanItem(user: any, id: number) {
    const item = await this.prisma.pulsePlanItem.findUnique({ where: { id } });
    if (!item || item.userId !== user.id) {
      throw new NotFoundException(`Plan item #${id} not found`);
    }

    await this.prisma.pulsePlanItem.delete({ where: { id } });
    return { success: true };
  }

  async startFocusSession(user: any, dto: StartFocusSessionDto) {
    const active = await this.prisma.pulseFocusSession.findFirst({
      where: {
        userId: user.id,
        status: { in: ['active', 'paused'] },
      },
    });

    if (active) {
      throw new ConflictException('Finish or resume your existing focus session first.');
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
    const session = await this.prisma.pulseFocusSession.findUnique({
      where: { id },
      include: { planItem: { include: { task: { include: { project: true } } } } },
    });

    if (!session || session.userId !== user.id) {
      throw new NotFoundException(`Session #${id} not found`);
    }

    if (session.status !== 'active') {
      throw new ConflictException('Only an active focus session can be paused.');
    }

    const elapsed = this.computeElapsed(session);
    const updated = await this.prisma.pulseFocusSession.update({
      where: { id },
      data: {
        status: 'paused',
        elapsedSeconds: elapsed,
        lastResumedAt: null,
      },
      include: { planItem: { include: { task: { include: { project: true } } } } },
    });

    return this.mapSession(updated);
  }

  async resumeFocusSession(user: any, id: number) {
    const session = await this.prisma.pulseFocusSession.findUnique({
      where: { id },
      include: { planItem: { include: { task: { include: { project: true } } } } },
    });

    if (!session || session.userId !== user.id) {
      throw new NotFoundException(`Session #${id} not found`);
    }

    if (session.status !== 'paused') {
      throw new ConflictException('Only a paused focus session can be resumed.');
    }

    const updated = await this.prisma.pulseFocusSession.update({
      where: { id },
      data: {
        status: 'active',
        lastResumedAt: new Date(),
      },
      include: { planItem: { include: { task: { include: { project: true } } } } },
    });

    return this.mapSession(updated);
  }

  async completeFocusSession(user: any, id: number) {
    const session = await this.prisma.pulseFocusSession.findUnique({
      where: { id },
      include: { planItem: { include: { task: { include: { project: true } } } } },
    });

    if (!session || session.userId !== user.id) {
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
      include: { planItem: { include: { task: { include: { project: true } } } } },
    });

    return this.mapSession(updated);
  }
}
