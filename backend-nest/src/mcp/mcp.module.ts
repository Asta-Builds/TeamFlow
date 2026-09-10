import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { clerkMiddleware } from '@clerk/express';
import {
  authServerMetadataHandlerClerk,
  mcpAuthClerk,
  protectedResourceHandlerClerk,
  streamableHttpHandler,
} from '@clerk/mcp-tools/express';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { AuthModule } from '../auth/auth.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { PulseModule } from '../pulse/pulse.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { McpPrincipalService } from './mcp-principal.service.js';
import { McpService } from './mcp.service.js';

@Module({
  imports: [AuthModule, OrganizationsModule, ProjectsModule, TasksModule, PulseModule],
  providers: [McpPrincipalService, McpService],
})
export class McpModule implements OnModuleInit {
  private readonly logger = new Logger(McpModule.name);

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly mcpService: McpService,
  ) {}

  onModuleInit() {
    if (process.env.MCP_ENABLED !== 'true') {
      this.logger.log('MCP endpoint disabled; set MCP_ENABLED=true to enable it');
      return;
    }
    if (!process.env.CLERK_SECRET_KEY || !process.env.CLERK_PUBLISHABLE_KEY) {
      throw new Error(
        'MCP_ENABLED=true requires CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY',
      );
    }

    const app = this.adapterHost.httpAdapter.getInstance();
    const metadataCors = (_req: Request, res: Response, next: NextFunction) => {
      res.set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      });
      if (_req.method === 'OPTIONS') return res.status(204).end();
      next();
    };

    app.options('/.well-known/oauth-protected-resource/mcp', metadataCors);
    app.get(
      '/.well-known/oauth-protected-resource/mcp',
      metadataCors,
      protectedResourceHandlerClerk({
        scopes_supported: ['openid', 'profile', 'email', 'teamflow.read', 'teamflow.write'],
      }),
    );
    app.options('/.well-known/oauth-authorization-server', metadataCors);
    app.get(
      '/.well-known/oauth-authorization-server',
      metadataCors,
      authServerMetadataHandlerClerk,
    );

    const router = Router();
    router.use(this.mcpCors());
    router.use(clerkMiddleware());
    router.all('/', mcpAuthClerk, streamableHttpHandler(this.mcpService.server));
    app.use('/mcp', router);

    this.logger.log('MCP endpoint enabled at /mcp');
  }

  private mcpCors() {
    const allowedOrigins = new Set(
      (process.env.MCP_CORS_ALLOWED_ORIGINS || process.env.CORS_ALLOWED_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    );
    return (req: Request, res: Response, next: NextFunction) => {
      const origin = req.header('origin');
      if (origin) {
        if (!allowedOrigins.has(origin)) {
          return res.status(403).json({ error: 'MCP origin is not allowed' });
        }
        res.set({
          'Access-Control-Allow-Origin': origin,
          Vary: 'Origin',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
          'Access-Control-Expose-Headers': 'Mcp-Session-Id',
        });
      }
      if (req.method === 'OPTIONS') return res.status(204).end();
      next();
    };
  }
}
