import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AgentsService } from './agents.service.js';
import { AgentsController } from './agents.controller.js';

@Module({
  imports: [HttpModule],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
