import { Module } from '@nestjs/common';
import { SeoService } from './seo.service.js';
import { SeoController } from './seo.controller.js';

@Module({
  controllers: [SeoController],
  providers: [SeoService],
  exports: [SeoService],
})
export class SeoModule {}
