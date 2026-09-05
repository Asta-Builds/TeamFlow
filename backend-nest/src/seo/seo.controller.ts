import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SeoService } from './seo.service.js';
import { CreateSeoAuditDto } from './dto/create-seo-audit.dto.js';
import { CreateSeoTaskDto } from './dto/create-seo-task.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@ApiTags('seo')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('seo/audits')
export class SeoController {
  constructor(private seoService: SeoService) {}

  @Get()
  @ApiOperation({ summary: 'List all SEO audits' })
  async findAll(@CurrentUser() user: any) {
    return this.seoService.findAll(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get SEO audit details' })
  async findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.seoService.findOne(id, user);
  }

  @Post()
  @ApiOperation({ summary: 'Trigger a new SEO audit' })
  async create(@Body() dto: CreateSeoAuditDto, @CurrentUser() user: any) {
    return this.seoService.create(dto, user);
  }

  @Post(':id/create-task')
  @ApiOperation({ summary: 'Convert an SEO audit issue into a task ticket' })
  async createTask(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateSeoTaskDto,
    @CurrentUser() user: any,
  ) {
    return this.seoService.createTask(id, dto, user);
  }

  @Post(':id/create_task')
  @ApiOperation({ summary: 'DRF compatibility: Convert SEO issue into task' })
  async createTaskCompat(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateSeoTaskDto,
    @CurrentUser() user: any,
  ) {
    return this.seoService.createTask(id, dto, user);
  }
}
