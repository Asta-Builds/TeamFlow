import {
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { PulseService } from '../pulse/pulse.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { McpPrincipalService } from './mcp-principal.service.js';

type McpContext = RequestHandlerExtra<ServerRequest, ServerNotification>;

const positiveId = z.number().int().min(1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const taskStatus = z.enum(['todo', 'in_progress', 'in_review', 'qa']);
const taskType = z.enum(['feature', 'bug', 'task']);
const priority = z.enum(['low', 'medium', 'high', 'urgent']);
const toolText = (value: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text: JSON.stringify(value, (_key, item) =>
        typeof item === 'bigint' ? item.toString() : item,
      ),
    },
  ],
});

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);
  readonly server = new McpServer({
    name: 'teamflow',
    version: '1.0.0',
  });

  constructor(
    private readonly principals: McpPrincipalService,
    private readonly organizations: OrganizationsService,
    private readonly projects: ProjectsService,
    private readonly tasks: TasksService,
    private readonly pulse: PulseService,
  ) {
    this.registerTools();
  }

  private registerTools() {
    this.server.registerTool(
      'teamflow_get_workspace',
      {
        title: 'Get TeamFlow workspace',
        description: 'Get the caller’s active TeamFlow workspace and metrics.',
        annotations: this.readOnly(),
      },
      async (extra) => this.run(extra, 'teamflow_get_workspace', false, (user) => this.organizations.getCurrent(user)),
    );

    this.server.registerTool(
      'teamflow_list_projects',
      {
        title: 'List projects',
        description: 'List projects visible to the caller in the active workspace.',
        inputSchema: z.object({
          status: z.string().trim().min(1).max(40).optional(),
          search: z.string().trim().min(1).max(120).optional(),
        }).strict(),
        annotations: this.readOnly(),
      },
      async (args, extra) => this.run(extra, 'teamflow_list_projects', false, (user) => this.projects.findAll(user, args)),
    );

    this.server.registerTool(
      'teamflow_get_project',
      {
        title: 'Get project',
        description: 'Get one project visible to the caller.',
        inputSchema: z.object({ project_id: positiveId }).strict(),
        annotations: this.readOnly(),
      },
      async ({ project_id }, extra) => this.run(extra, 'teamflow_get_project', false, (user) => this.projects.findOne(project_id, user)),
    );

    this.server.registerTool(
      'teamflow_list_tasks',
      {
        title: 'List tasks',
        description: 'List workspace tasks with optional board filters.',
        inputSchema: z.object({
          project: positiveId.optional(),
          status: z.enum(['todo', 'in_progress', 'in_review', 'qa', 'done']).optional(),
          priority: priority.optional(),
          task_type: taskType.optional(),
          assignee: positiveId.optional(),
          search: z.string().trim().min(1).max(120).optional(),
        }).strict(),
        annotations: this.readOnly(),
      },
      async (args, extra) => this.run(extra, 'teamflow_list_tasks', false, (user) => this.tasks.findAll(user, args)),
    );

    this.server.registerTool(
      'teamflow_get_task',
      {
        title: 'Get task',
        description: 'Get a task, including its comments and activity, when visible to the caller.',
        inputSchema: z.object({ task_id: positiveId }).strict(),
        annotations: this.readOnly(),
      },
      async ({ task_id }, extra) => this.run(extra, 'teamflow_get_task', false, (user) => this.tasks.findOne(task_id, user)),
    );

    this.server.registerTool(
      'teamflow_get_activity_feed',
      {
        title: 'Get activity feed',
        description: 'Get the caller’s active-workspace task activity feed.',
        annotations: this.readOnly(),
      },
      async (extra) => this.run(extra, 'teamflow_get_activity_feed', false, (user) => this.tasks.getFeed(user)),
    );

    this.server.registerTool(
      'teamflow_get_pulse_dashboard',
      {
        title: 'Get Pulse dashboard',
        description: 'Get the caller’s private daily Pulse dashboard.',
        inputSchema: z.object({ date: date.optional() }).strict(),
        annotations: this.readOnly(),
      },
      async ({ date: selectedDate }, extra) => this.run(extra, 'teamflow_get_pulse_dashboard', false, (user) => this.pulse.getDashboard(user, selectedDate)),
    );

    this.server.registerTool(
      'teamflow_get_pulse_note',
      {
        title: 'Get Pulse note',
        description: 'Get the caller’s private Pulse note for a date.',
        inputSchema: z.object({ date: date.optional() }).strict(),
        annotations: this.readOnly(),
      },
      async ({ date: selectedDate }, extra) => this.run(extra, 'teamflow_get_pulse_note', false, (user) => this.pulse.getNote(user, selectedDate)),
    );

    this.server.registerTool(
      'teamflow_list_pulse_plan',
      {
        title: 'List Pulse plan',
        description: 'List the caller’s private Pulse plan for a date.',
        inputSchema: z.object({ date: date.optional() }).strict(),
        annotations: this.readOnly(),
      },
      async ({ date: selectedDate }, extra) => this.run(extra, 'teamflow_list_pulse_plan', false, (user) => this.pulse.getPlanItems(user, selectedDate)),
    );

    this.server.registerTool(
      'teamflow_create_project',
      {
        title: 'Create project',
        description: 'Create a TeamFlow project. TeamFlow role rules still apply.',
        inputSchema: z.object({
          name: z.string().trim().min(1).max(150),
          description: z.string().max(10000).optional(),
          status: z.string().trim().min(1).max(40).optional(),
          github_repo: z.string().trim().max(255).optional(),
          members: z.array(positiveId).max(50).optional(),
        }).strict(),
        annotations: this.safeWrite(),
      },
      async (args, extra) => this.run(extra, 'teamflow_create_project', true, (user) => this.projects.create(args, user)),
    );

    this.server.registerTool(
      'teamflow_update_project',
      {
        title: 'Update project',
        description: 'Update non-destructive project fields. TeamFlow role rules still apply.',
        inputSchema: z.object({
          project_id: positiveId,
          name: z.string().trim().min(1).max(150).optional(),
          description: z.string().max(10000).optional(),
          status: z.string().trim().min(1).max(40).optional(),
          github_repo: z.string().trim().max(255).optional(),
          members: z.array(positiveId).max(50).optional(),
        }).strict(),
        annotations: this.safeWrite(),
      },
      async ({ project_id, ...args }, extra) => this.run(extra, 'teamflow_update_project', true, (user) => this.projects.update(project_id, args, user)),
    );

    this.server.registerTool(
      'teamflow_create_task',
      {
        title: 'Create task',
        description: 'Create a non-terminal task in a visible TeamFlow project.',
        inputSchema: z.object({
          project: positiveId,
          title: z.string().trim().min(1).max(255),
          description: z.string().max(20000).optional(),
          status: taskStatus.optional(),
          task_type: taskType.optional(),
          priority: priority.optional(),
          assignee: positiveId.optional(),
          due_date: date.optional(),
          pr_url: z.string().url().max(500).optional(),
          order: z.number().int().min(0).max(100000).optional(),
        }).strict(),
        annotations: this.safeWrite(),
      },
      async (args, extra) => this.run(extra, 'teamflow_create_task', true, (user) => this.tasks.create(args, user)),
    );

    this.server.registerTool(
      'teamflow_update_task',
      {
        title: 'Update task',
        description: 'Update a task without making a QA decision or closing it.',
        inputSchema: z.object({
          task_id: positiveId,
          title: z.string().trim().min(1).max(255).optional(),
          description: z.string().max(20000).optional(),
          status: taskStatus.optional(),
          task_type: taskType.optional(),
          priority: priority.optional(),
          assignee: positiveId.nullable().optional(),
          due_date: date.nullable().optional(),
          pr_url: z.string().url().max(500).optional(),
          order: z.number().int().min(0).max(100000).optional(),
        }).strict(),
        annotations: this.safeWrite(),
      },
      async ({ task_id, ...args }, extra) => this.run(extra, 'teamflow_update_task', true, (user) => this.tasks.update(task_id, args, user)),
    );

    this.server.registerTool(
      'teamflow_add_task_comment',
      {
        title: 'Add task comment',
        description: 'Add a comment to a visible TeamFlow task.',
        inputSchema: z.object({
          task_id: positiveId,
          body: z.string().trim().min(1).max(10000),
        }).strict(),
        annotations: this.safeWrite(),
      },
      async ({ task_id, body }, extra) => this.run(extra, 'teamflow_add_task_comment', true, (user) => this.tasks.addComment(task_id, body, user)),
    );

    this.server.registerTool(
      'teamflow_update_pulse_note',
      {
        title: 'Update Pulse note',
        description: 'Save the caller’s private Pulse note.',
        inputSchema: z.object({
          date: date.optional(),
          body: z.string().max(20000),
        }).strict(),
        annotations: this.safeWrite(),
      },
      async (args, extra) => this.run(extra, 'teamflow_update_pulse_note', true, (user) => this.pulse.updateNote(user, args)),
    );

    this.server.registerTool(
      'teamflow_add_pulse_plan_item',
      {
        title: 'Add Pulse plan item',
        description: 'Add a visible task to the caller’s private Pulse plan.',
        inputSchema: z.object({
          task: positiveId,
          date,
          time_block: z.enum(['morning', 'afternoon', 'evening']).optional(),
          position: z.number().int().min(0).max(100000).optional(),
        }).strict(),
        annotations: this.safeWrite(),
      },
      async (args, extra) => this.run(extra, 'teamflow_add_pulse_plan_item', true, (user) => this.pulse.createPlanItem(user, args)),
    );

    this.server.registerTool(
      'teamflow_remove_pulse_plan_item',
      {
        title: 'Remove Pulse plan item',
        description: 'Remove one item from the caller’s private Pulse plan.',
        inputSchema: z.object({ plan_item_id: positiveId }).strict(),
        annotations: this.safeWrite(),
      },
      async ({ plan_item_id }, extra) => this.run(extra, 'teamflow_remove_pulse_plan_item', true, (user) => this.pulse.deletePlanItem(user, plan_item_id)),
    );
  }

  private readOnly() {
    return {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    };
  }

  private safeWrite() {
    return {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    };
  }

  private async run(
    extra: McpContext,
    tool: string,
    requiresWrite: boolean,
    operation: (user: any) => Promise<unknown>,
  ) {
    let userId = 'unknown';
    try {
      const user = await this.principals.resolve(extra.authInfo, requiresWrite);
      userId = String(user.id);
      const result = await operation(user);
      this.audit(tool, userId, 'success');
      return toolText(result);
    } catch (error) {
      this.audit(tool, userId, 'denied_or_failed');
      return {
        isError: true,
        ...toolText({ error: this.messageFor(error) }),
      };
    }
  }

  private audit(tool: string, userId: string, outcome: string) {
    this.logger.log(JSON.stringify({ event: 'mcp_tool_call', tool, userId, outcome }));
  }

  private messageFor(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'string') return response;
      const message = response && typeof response === 'object' ? (response as { message?: unknown }).message : undefined;
      if (Array.isArray(message)) return message.join('; ');
      if (typeof message === 'string') return message;
    }
    if (error instanceof ForbiddenException) return error.message;
    return 'The TeamFlow MCP request could not be completed.';
  }
}
