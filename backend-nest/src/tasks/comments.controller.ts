import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { TasksService } from './tasks.service.js';
import { CreateCommentDto } from './dto/create-comment.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@ApiTags('comments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('comments')
export class CommentsController {
  constructor(private tasksService: TasksService) {}

  @Get()
  @ApiOperation({ summary: 'List comments for a task' })
  @ApiQuery({ name: 'task', required: false, type: Number })
  async findAll(@Query('task') task?: string) {
    const taskId = task ? parseInt(task, 10) : undefined;
    return this.tasksService.getComments(taskId);
  }

  @Post()
  @ApiOperation({ summary: 'Post a comment to a task' })
  async create(@Body() dto: CreateCommentDto, @CurrentUser() user: any) {
    if (!dto.task) {
      throw new BadRequestException('The task field is required');
    }
    return this.tasksService.addComment(dto.task, dto.body, user);
  }
}
