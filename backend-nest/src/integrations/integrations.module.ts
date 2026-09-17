import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { IntegrationsController } from './integrations.controller.js';

@Module({
  imports: [HttpModule],
  controllers: [IntegrationsController],
})
export class IntegrationsModule {}
