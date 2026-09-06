import {
  Controller,
  HttpCode,
  HttpStatus,
  Get,
  Post,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import type { Response } from 'express';
import { AgentsService } from './agents.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  constructor(private agentsService: AgentsService) {}

  @Get(['status', 'status/'])
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List status of all 9 AI agent specialists in the swarm',
  })
  getStatus(@CurrentUser() user: any) {
    return this.agentsService.getStatus(user);
  }

  @Get(['swarm-feed', 'swarm-feed/'])
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Live feed of swarm agent events and handoffs' })
  async getSwarmFeed(@CurrentUser() user: any) {
    return this.agentsService.getSwarmFeed(user);
  }

  @Get(['traces', 'traces/'])
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Execution traces of multi-agent runs' })
  async getTraces(@CurrentUser() user: any) {
    return this.agentsService.getTraces(user);
  }

  @Get(['traces/:taskId', 'traces/:taskId/'])
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Execution traces for a specific ticket' })
  async getTracesForTask(
    @Param('taskId', ParseIntPipe) taskId: number,
    @CurrentUser() user: any,
  ) {
    return this.agentsService.getTracesForTask(taskId, user);
  }

  @Post(['dispatch/:taskId', 'dispatch/:taskId/'])
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Dispatch autonomous agent swarm on a specific ticket',
  })
  async dispatch(
    @Param('taskId', ParseIntPipe) taskId: number,
    @CurrentUser() user: any,
  ) {
    return this.agentsService.dispatch(taskId, user);
  }

  @Post(['swarm-chain/:taskId', 'swarm-chain/:taskId/'])
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Execute sequential multi-agent swarm chain on a specific ticket',
  })
  async executeSwarmChain(
    @Param('taskId', ParseIntPipe) taskId: number,
    @Body() body: { instruction?: string },
    @CurrentUser() user: any,
  ) {
    return this.agentsService.executeSwarmChain(
      taskId,
      body?.instruction || '',
      user,
    );
  }

  @Post(['ingest-rag', 'ingest-rag/'])
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Trigger codebase RAG embedding ingestion' })
  async ingestRAG(
    @Body() body: { project_id?: number },
    @CurrentUser() user: any,
  ) {
    return this.agentsService.ingestRAG(body?.project_id, user);
  }

  @Get(['events', 'events/'])
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Retrieve lifecycle events for agents' })
  @ApiQuery({ name: 'project', required: false })
  @ApiQuery({ name: 'task', required: false })
  @ApiQuery({ name: 'session', required: false })
  @ApiQuery({ name: 'after', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getEvents(
    @CurrentUser() user: any,
    @Query('project') project?: string,
    @Query('task') task?: string,
    @Query('session') session?: string,
    @Query('after') after?: string,
    @Query('limit') limit?: string,
  ) {
    return this.agentsService.getEvents(user, {
      projectId: project ? parseInt(project, 10) : undefined,
      taskId: task ? parseInt(task, 10) : undefined,
      sessionId: session,
      after: after ? parseInt(after, 10) : 0,
      limit: limit ? parseInt(limit, 10) : 100,
    });
  }

  @Get(['events/stream', 'events/stream/'])
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Real-time SSE event stream for agents' })
  @ApiQuery({ name: 'project', required: false })
  @ApiQuery({ name: 'task', required: false })
  @ApiQuery({ name: 'session', required: false })
  @ApiQuery({ name: 'after', required: false })
  async streamEvents(
    @CurrentUser() user: any,
    @Query('project') project?: string,
    @Query('task') task?: string,
    @Query('session') session?: string,
    @Query('after') after?: string,
    @Res() res?: Response,
  ) {
    return this.agentsService.streamEvents(
      user,
      {
        projectId: project ? parseInt(project, 10) : undefined,
        taskId: task ? parseInt(task, 10) : undefined,
        sessionId: session,
        after: after ? parseInt(after, 10) : 0,
      },
      res,
    );
  }
}
