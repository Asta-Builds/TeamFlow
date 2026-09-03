import { Controller, Get, Res, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { PrismaService } from './prisma/prisma.service.js';

@ApiTags('system')
@Controller()
export class AppController {
  constructor(private prisma: PrismaService) {}

  @Get('health')
  @ApiOperation({ summary: 'System and database health check' })
  async health(@Res() res: Response) {
    let dbOk = true;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbOk = false;
    }

    const statusCode = dbOk ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
    return res.status(statusCode).json({
      status: dbOk ? 'ok' : 'unhealthy',
      service: 'teamflow-api-nest',
      database: dbOk ? 'connected' : 'disconnected',
      framework: 'NestJS 12',
      timestamp: new Date().toISOString(),
    });
  }

  @Get()
  @ApiOperation({ summary: 'API Root Information' })
  getRoot() {
    return {
      name: 'TeamFlow NestJS Core API',
      version: '1.0.0',
      docs: '/api/docs',
      health: '/api/health',
    };
  }
}
