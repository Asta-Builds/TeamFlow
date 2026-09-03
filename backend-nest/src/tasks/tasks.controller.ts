import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { TasksService } from './tasks.service.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';
import { CreateCommentDto } from './dto/create-comment.dto.js';
import { QaRejectDto } from './dto/qa-reject.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@ApiTags('tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(private tasksService: TasksService) {}

  @Get()
  @ApiOperation({ summary: 'List tasks with board filters' })
  @ApiQuery({ name: 'project', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'priority', required: false })
  @ApiQuery({ name: 'task_type', required: false })
  @ApiQuery({ name: 'assignee', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false })
  async findAll(
    @CurrentUser() user: any,
    @Query('project') project?: string,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('task_type') task_type?: string,
    @Query('assignee') assignee?: string,
    @Query('search') search?: string,
  ) {
    return this.tasksService.findAll(user, {
      project: project ? parseInt(project, 10) : undefined,
      status,
      priority,
      task_type,
      assignee: assignee ? parseInt(assignee, 10) : undefined,
      search,
    });
  }

  @Get('my_tasks')
  @ApiOperation({ summary: 'List tasks assigned to the current user' })
  async getMyTasks(@CurrentUser() user: any) {
    return this.tasksService.getMyTasks(user);
  }

  @Get('feed')
  @ApiOperation({ summary: 'Activity feed across all tasks in current workspace' })
  async getFeed(@CurrentUser() user: any) {
    return this.tasksService.getFeed(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details of a single task' })
  async findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.tasksService.findOne(id, user);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new task ticket' })
  async create(@Body() dto: CreateTaskDto, @CurrentUser() user: any) {
    return this.tasksService.create(dto, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partially update task' })
  async patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: any,
  ) {
    return this.tasksService.update(id, dto, user);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update task' })
  async put(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: any,
  ) {
    return this.tasksService.update(id, dto, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a task ticket' })
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.tasksService.remove(id, user);
  }

  @Post(':id/qa_validate')
  @ApiOperation({ summary: 'QA Engineer validates ticket to Done' })
  async qaValidate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.tasksService.qaValidate(id, user);
  }

  @Post(':id/qa_reject')
  @ApiOperation({ summary: 'QA Engineer rejects ticket back to In Progress with explanation' })
  async qaReject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: QaRejectDto,
    @CurrentUser() user: any,
  ) {
    return this.tasksService.qaReject(id, dto.reason, user);
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'Add a comment / update thread on a task' })
  async addComment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: any,
  ) {
    return this.tasksService.addComment(id, dto.body, user);
  }
}
