import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service.js';
import { TasksController } from './tasks.controller.js';
import { CommentsController } from './comments.controller.js';

@Module({
  controllers: [TasksController, CommentsController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
