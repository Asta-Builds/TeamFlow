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
        task: { select: { title: true, projectId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return traces.map((t) => ({
      id: t.id,
      task: t.taskId,
      task_title: t.task?.title,
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
}
