import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SeoService } from './seo.service.js';
import { SeoController } from './seo.controller.js';

@Module({
  imports: [HttpModule],
  controllers: [SeoController],
  providers: [SeoService],
  exports: [SeoService],
})
export class SeoModule {}
