import { Module } from '@nestjs/common';
import { PulseService } from './pulse.service.js';
import { PulseController } from './pulse.controller.js';

@Module({
  controllers: [PulseController],
  providers: [PulseService],
  exports: [PulseService],
})
export class PulseModule {}
