import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DeploymentsService } from './deployments.service.js';
import { DeploymentsController } from './deployments.controller.js';

@Module({
  imports: [HttpModule],
  controllers: [DeploymentsController],
  providers: [DeploymentsService],
  exports: [DeploymentsService],
})
export class DeploymentsModule {}
