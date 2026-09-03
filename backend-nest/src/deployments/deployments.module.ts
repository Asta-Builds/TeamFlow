import { Module } from '@nestjs/common';
import { DeploymentsService } from './deployments.service.js';
import { DeploymentsController } from './deployments.controller.js';

@Module({
  controllers: [DeploymentsController],
  providers: [DeploymentsService],
  exports: [DeploymentsService],
})
export class DeploymentsModule {}
