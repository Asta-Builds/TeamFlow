import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { PulseService } from './pulse.service.js';
import { CreatePlanItemDto, UpdateNoteDto, StartFocusSessionDto } from './dto/pulse.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@ApiTags('pulse')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('pulse')
export class PulseController {
  constructor(private pulseService: PulseService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get Pulse daily dashboard' })
  @ApiQuery({ name: 'date', required: false })
  async getDashboard(@CurrentUser() user: any, @Query('date') date?: string) {
    return this.pulseService.getDashboard(user, date);
  }

  @Get('note')
  @ApiOperation({ summary: 'Get private scratchpad note for date' })
  @ApiQuery({ name: 'date', required: false })
  async getNote(@CurrentUser() user: any, @Query('date') date?: string) {
    return this.pulseService.getNote(user, date);
  }

  @Put('note')
  @ApiOperation({ summary: 'Save/update private scratchpad note for date' })
  async updateNote(@CurrentUser() user: any, @Body() dto: UpdateNoteDto) {
    return this.pulseService.updateNote(user, dto);
  }

  @Get('plan-items')
  @ApiOperation({ summary: 'List daily planned task items' })
  @ApiQuery({ name: 'date', required: false })
  async getPlanItems(@CurrentUser() user: any, @Query('date') date?: string) {
    return this.pulseService.getPlanItems(user, date);
  }

  @Post('plan-items')
  @ApiOperation({ summary: 'Add a task to daily plan' })
  async createPlanItem(@CurrentUser() user: any, @Body() dto: CreatePlanItemDto) {
    return this.pulseService.createPlanItem(user, dto);
  }

  @Delete('plan-items/:id')
  @ApiOperation({ summary: 'Remove a task from daily plan' })
  async deletePlanItem(@CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.pulseService.deletePlanItem(user, id);
  }

  @Post('focus-sessions/start')
  @ApiOperation({ summary: 'Start or launch a focus timer session' })
  async startFocusSession(@CurrentUser() user: any, @Body() dto: StartFocusSessionDto) {
    return this.pulseService.startFocusSession(user, dto);
  }

  @Post('focus-sessions/:id/pause')
  @ApiOperation({ summary: 'Pause an active focus session' })
  async pauseFocusSession(@CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.pulseService.pauseFocusSession(user, id);
  }

  @Post('focus-sessions/:id/resume')
  @ApiOperation({ summary: 'Resume a paused focus session' })
  async resumeFocusSession(@CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.pulseService.resumeFocusSession(user, id);
  }

  @Post('focus-sessions/:id/complete')
  @ApiOperation({ summary: 'Complete a focus session' })
  async completeFocusSession(@CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.pulseService.completeFocusSession(user, id);
  }
}
