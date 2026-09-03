import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { DeploymentsService } from './deployments.service.js';
import { CreateDeploymentDto } from './dto/create-deployment.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@ApiTags('deployments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('deployments')
export class DeploymentsController {
  constructor(private deploymentsService: DeploymentsService) {}

  @Get()
  @ApiOperation({ summary: 'List deployments in workspace' })
  @ApiQuery({ name: 'project', required: false, type: Number })
  @ApiQuery({ name: 'environment', required: false })
  @ApiQuery({ name: 'status', required: false })
  async findAll(
    @CurrentUser() user: any,
    @Query('project') project?: string,
    @Query('environment') environment?: string,
    @Query('status') status?: string,
  ) {
    return this.deploymentsService.findAll(user, {
      project: project ? parseInt(project, 10) : undefined,
      environment,
      status,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get deployment details and logs' })
  async findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.deploymentsService.findOne(id, user);
  }

  @Post()
  @ApiOperation({ summary: 'Trigger a new deployment' })
  async create(@Body() dto: CreateDeploymentDto, @CurrentUser() user: any) {
    return this.deploymentsService.create(dto, user);
  }

  @Post(':id/rollback')
  @ApiOperation({ summary: '1-click rollback to previous stable release' })
  async rollback(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.deploymentsService.rollback(id, user);
  }
}
