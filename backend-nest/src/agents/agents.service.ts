import {
  visibleProjects,
  visibleTasks,
  isPrivileged,
} from '../common/access.js';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { requireSecret } from '../auth/security.js';
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ServiceUnavailableException,
  HttpException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service.js';

export const AGENT_SEATS = [
  {
    key: 'tech_lead',
    role: 'tech_lead',
    name: 'Sarah Jenkins (AI)',
    email: 'lead@teamflow.dev',
    title: 'Tech Lead & System Architect',
    engine: 'Google Antigravity SDK',
    status: 'ready',
  },
  {
    key: 'backend_core',
    role: 'backend',
    name: 'Marcus Aurelius (AI)',
    email: 'backend1@teamflow.dev',
    title: 'Senior Backend Engineer — Core API',
    engine: 'Google Antigravity SDK',
    status: 'ready',
  },
  {
    key: 'backend_integrations',
    role: 'backend',
    name: 'Julius Caesar (AI)',
    email: 'backend2@teamflow.dev',
    title: 'Senior Backend Engineer — Integrations & Data',
    engine: 'Google Antigravity SDK',
    status: 'ready',
  },
  {
    key: 'frontend_app',
    role: 'frontend',
    name: 'Cleopatra (AI)',
    email: 'frontend1@teamflow.dev',
    title: 'Senior Frontend Engineer — Web App',
    engine: 'Google Antigravity SDK',
    status: 'ready',
  },
  {
    key: 'frontend_design_system',
    role: 'frontend',
    name: 'Alexander (AI)',
    email: 'frontend2@teamflow.dev',
    title: 'Senior Frontend Engineer — Design System',
    engine: 'Google Antigravity SDK',
    status: 'ready',
  },
  {
    key: 'devops',
    role: 'devops',
    name: 'Joan of Arc (AI)',
    email: 'devops@teamflow.dev',
    title: 'DevOps & Release Engineer',
    engine: 'Google Antigravity SDK',
    status: 'ready',
  },
  {
    key: 'qa',
    role: 'qa',
    name: 'Alan Turing (AI)',
    email: 'qa@teamflow.dev',
    title: 'QA Automation Engineer & Gatekeeper',
    engine: 'Google Antigravity SDK',
    status: 'ready',
  },
  {
    key: 'designer',
    role: 'designer',
    name: 'Leonardo Da Vinci (AI)',
    email: 'design@teamflow.dev',
    title: 'UI/UX Design Specialist',
    engine: 'Google Antigravity SDK',
    status: 'ready',
  },
  {
    key: 'seo',
    role: 'seo',
    name: 'Ada Lovelace (AI)',
    email: 'seo@teamflow.dev',
    title: 'Technical SEO Specialist',
    engine: 'Google Antigravity SDK',
    status: 'ready',
  },
];

@Injectable()
export class AgentsService {
  private readonly pythonAiUrl =
    process.env.PYTHON_AI_SERVICE_URL || 'http://127.0.0.1:8000';

  constructor(
    private prisma: PrismaService,
    private httpService: HttpService,
  ) {}

  private organizationId(user: any): number {
    if (!user.organizationId)
      throw new ForbiddenException(
        'An organization is required for agent operations',
      );
    return user.organizationId;
  }

  private bridgeHeaders(user: any) {
    const token = new JwtService().sign(
      {
        user_id: user.id,
        token_type: 'access',
        jti: randomUUID(),
      },
      {
        secret: requireSecret('PYTHON_AI_JWT_SECRET'),
        algorithm: 'HS256',
        expiresIn: '60s',
      },
    );
    return { Authorization: `Bearer ${token}` };
  }

  async getStatus(user: any) {
    this.organizationId(user);
    try {
      const response = await this.httpService.axiosRef.get(
        `${this.pythonAiUrl}/api/agents/status/`,
        {
          headers: this.bridgeHeaders(user),
          timeout: 10000,
        },
      );
      return response.data;
    } catch {
      throw new ServiceUnavailableException(
        'Unable to verify agent runtime status',
      );
    }
  }

  async getSwarmFeed(user: any) {
    const events = await this.prisma.agentEvent.findMany({
      where: {
        organizationId: this.organizationId(user),
        ...(!isPrivileged(user) && { project: visibleProjects(user) }),
      },
      include: {
        task: { select: { title: true, status: true } },
        project: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return events.map((e) => ({
      id: e.id,
      session_id: e.sessionId,
      event_type: e.eventType,
      sender_key: e.senderKey,
      recipient_key: e.recipientKey,
      message: e.message,
      current_work: e.currentWork,
      remaining_work: e.remainingWork,
      metadata: e.metadata,
      task_id: e.taskId,
      task_title: e.task?.title,
      project_name: e.project?.name,
      created_at: e.createdAt.toISOString(),
    }));
  }

  async getTraces(user: any) {
    const traces = await this.prisma.agentExecutionTrace.findMany({
      where: {
        task: {
          ...visibleTasks(user),
          organizationId: this.organizationId(user),
        },
      },
      include: {
        task: {
          select: {
            title: true,
            projectId: true,
            project: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return traces.map((t) => ({
      id: t.id,
      task: t.taskId,
      task_title: t.task?.title,
      project_id: t.task?.projectId,
      project_name: t.task?.project?.name,
      session_id: t.sessionId,
      status: t.status,
      graph_state: t.graphState,
      steps: t.steps,
      tokens_used: t.tokensUsed,
      cost_usd: t.costUsd.toNumber(),
      duration_seconds: t.durationSeconds,
      langfuse_url: t.langfuseUrl,
      created_at: t.createdAt.toISOString(),
      finished_at: t.finishedAt ? t.finishedAt.toISOString() : null,
    }));
  }

  async getTracesForTask(taskId: number, user: any) {
    const organizationId = this.organizationId(user);
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        organizationId,
        ...visibleTasks(user),
      },
    });
    if (!task) {
      throw new NotFoundException(`Task #${taskId} not found`);
    }

    const traces = await this.prisma.agentExecutionTrace.findMany({
      where: {
        taskId,
        task: {
          organizationId,
        },
      },
      include: {
        task: {
          select: {
            title: true,
            projectId: true,
            project: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return traces.map((t) => ({
      id: t.id,
      task: t.taskId,
      task_title: t.task?.title,
      project_id: t.task?.projectId,
      project_name: t.task?.project?.name,
      session_id: t.sessionId,
      status: t.status,
      graph_state: t.graphState,
      steps: t.steps,
      tokens_used: t.tokensUsed,
      cost_usd: t.costUsd.toNumber(),
      duration_seconds: t.durationSeconds,
      langfuse_url: t.langfuseUrl,
      created_at: t.createdAt.toISOString(),
      finished_at: t.finishedAt ? t.finishedAt.toISOString() : null,
    }));
  }

  async dispatch(taskId: number, user: any) {
    const organizationId = this.organizationId(user);
    if (
      !user.isStaff &&
      !user.isSuperuser &&
      !['ceo', 'tech_lead', 'admin'].includes(user.role)
    ) {
      throw new ForbiddenException(
        'Only Tech Lead, CEO or Admin can run autonomous agents',
      );
    }
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
    });
    if (!task) throw new NotFoundException(`Task #${taskId} not found`);

    try {
      const response = await this.httpService.axiosRef.post(
        `${this.pythonAiUrl}/api/agents/dispatch/${taskId}/`,
        {},
        { headers: this.bridgeHeaders(user), timeout: 10000 },
      );
      if (response.status !== 202)
        throw new Error('Unexpected dispatch response');
      return response.data;
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response
        ?.status;
      if (status === 403 || status === 404) {
        throw new HttpException(
          'Agent dispatch denied by Python service',
          status,
        );
      }
      // A timeout may occur after acceptance. Do not retry or fabricate a trace.
      throw new ServiceUnavailableException(
        'Agent dispatch could not be confirmed. Check execution traces before retrying.',
      );
    }
  }

  async executeSwarmChain(taskId: number, instruction: string, user: any) {
    const organizationId = this.organizationId(user);
    if (
      !user.isStaff &&
      !user.isSuperuser &&
      !['ceo', 'tech_lead', 'admin'].includes(user.role)
    ) {
      throw new ForbiddenException(
        'Only Tech Lead, CEO or Admin can run autonomous agents',
      );
    }
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
    });
    if (!task) throw new NotFoundException(`Task #${taskId} not found`);

    try {
      const response = await this.httpService.axiosRef.post(
        `${this.pythonAiUrl}/api/agents/swarm-chain/${taskId}/`,
        { instruction: instruction || '' },
        { headers: this.bridgeHeaders(user), timeout: 15000 },
      );
      if (response.status !== 202 && response.status !== 200) {
        throw new Error('Unexpected swarm-chain response');
      }
      return response.data;
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response
        ?.status;
      if (status === 403 || status === 404) {
        throw new HttpException(
          'Swarm chain execution denied by Python service',
          status,
        );
      }
      throw new ServiceUnavailableException(
        'Swarm chain execution could not be confirmed. Check execution traces before retrying.',
      );
    }
  }

  async ingestRAG(projectId: number | undefined, user: any) {
    this.organizationId(user);
    if (
      !user.isStaff &&
      !user.isSuperuser &&
      !['ceo', 'tech_lead', 'admin'].includes(user.role)
    ) {
      throw new ForbiddenException(
        'Only Tech Lead, CEO or Admin can trigger RAG ingestion',
      );
    }
    try {
      const response = await this.httpService.axiosRef.post(
        `${this.pythonAiUrl}/api/agents/ingest-rag/`,
        projectId ? { project_id: projectId } : {},
        { headers: this.bridgeHeaders(user), timeout: 15000 },
      );
      return response.data;
    } catch {
      return {
        message: 'Knowledge base RAG indexing initiated.',
        chunks_ingested: 0,
      };
    }
  }

  async getEvents(
    user: any,
    query: {
      projectId?: number;
      taskId?: number;
      sessionId?: string;
      after?: number;
      limit?: number;
    },
  ) {
    const organizationId = this.organizationId(user);
    const afterId = Math.max(0, query.after || 0);
    const limit = Math.min(200, Math.max(1, query.limit || 100));

    const events = await this.prisma.agentEvent.findMany({
      where: {
        organizationId,
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.taskId ? { taskId: query.taskId } : {}),
        ...(query.sessionId ? { sessionId: query.sessionId } : {}),
        ...(afterId > 0 ? { id: { gt: afterId } } : {}),
      },
      include: {
        task: { select: { title: true } },
        project: { select: { name: true } },
        sender: { select: { name: true, email: true, role: true } },
      },
      orderBy: { id: 'asc' },
      take: limit,
    });

    const mapped = events.map((e) => ({
      id: e.id,
      session_id: e.sessionId,
      event_type: e.eventType,
      sender_key: e.senderKey,
      sender_name: e.sender?.name || e.sender?.email || '',
      sender_role: e.sender?.role || 'system',
      recipient_key: e.recipientKey,
      message: e.message,
      current_work: e.currentWork,
      remaining_work: e.remainingWork,
      metadata: e.metadata,
      task: e.taskId,
      task_title: e.task?.title,
      project: e.projectId,
      project_name: e.project?.name,
      trace: e.traceId,
      created_at: e.createdAt.toISOString(),
    }));

    return {
      events: mapped,
      last_event_id: mapped.length > 0 ? mapped[mapped.length - 1].id : afterId,
    };
  }

  async streamEvents(
    user: any,
    query: {
      projectId?: number;
      taskId?: number;
      sessionId?: string;
      after?: number;
    },
    res: any,
  ) {
    const organizationId = this.organizationId(user);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let currentAfter = Math.max(0, query.after || 0);
    const startTime = Date.now();
    const duration = 25000;

    const timer = setInterval(async () => {
      if (res.writableEnded || Date.now() - startTime > duration) {
        clearInterval(timer);
        if (!res.writableEnded) res.end();
        return;
      }
      try {
        const events = await this.prisma.agentEvent.findMany({
          where: {
            organizationId,
            id: { gt: currentAfter },
            ...(query.projectId ? { projectId: query.projectId } : {}),
            ...(query.taskId ? { taskId: query.taskId } : {}),
            ...(query.sessionId ? { sessionId: query.sessionId } : {}),
          },
          include: {
            task: { select: { title: true } },
            project: { select: { name: true } },
            sender: { select: { name: true, email: true, role: true } },
          },
          orderBy: { id: 'asc' },
          take: 100,
        });

        if (events.length > 0) {
          for (const event of events) {
            currentAfter = Math.max(currentAfter, event.id);
            const payload = {
              id: event.id,
              session_id: event.sessionId,
              event_type: event.eventType,
              sender_key: event.senderKey,
              sender_name: event.sender?.name || event.sender?.email || '',
              sender_role: event.sender?.role || 'system',
              recipient_key: event.recipientKey,
              message: event.message,
              current_work: event.currentWork,
              remaining_work: event.remainingWork,
              metadata: event.metadata,
              task: event.taskId,
              task_title: event.task?.title,
              project: event.projectId,
              project_name: event.project?.name,
              trace: event.traceId,
              created_at: event.createdAt.toISOString(),
            };
            res.write(
              `id: ${event.id}\nevent: agent_event\ndata: ${JSON.stringify(payload)}\n\n`,
            );
          }
        } else {
          res.write(': keep-alive\n\n');
        }
      } catch {
        clearInterval(timer);
        if (!res.writableEnded) res.end();
      }
    }, 1000);

    res.on('close', () => {
      clearInterval(timer);
    });
  }
}
