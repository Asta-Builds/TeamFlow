import {
  Controller,
  HttpCode,
  HttpStatus,
  Get,
  Post,
  Param,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AgentsService } from './agents.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  constructor(private agentsService: AgentsService) {}

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List status of all 9 AI agent specialists in the swarm',
  })
  getStatus(@CurrentUser() user: any) {
    return this.agentsService.getStatus(user);
  }

  @Get('swarm-feed')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Live feed of swarm agent events and handoffs' })
  async getSwarmFeed(@CurrentUser() user: any) {
    return this.agentsService.getSwarmFeed(user);
  }

  @Get('traces')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Execution traces of multi-agent runs' })
  async getTraces(@CurrentUser() user: any) {
    return this.agentsService.getTraces(user);
  }

  @Post('dispatch/:taskId')
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
}
