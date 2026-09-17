import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { isPrivileged, requireOrganization } from '../common/access.js';
import { bridgeGet, bridgePost } from '../common/python-bridge.js';

const PROVIDERS = new Set(['github', 'slack']);

/**
 * Workspace integrations (GitHub, Slack) are stored and exercised by the Django
 * execution service; this controller authorizes the caller and forwards the request.
 */
@ApiTags('integrations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly http: HttpService) {}

  private authorize(user: any, provider: string) {
    requireOrganization(user);
    if (!PROVIDERS.has(provider)) {
      throw new ForbiddenException('Unknown integration');
    }
    if (!isPrivileged(user)) {
      throw new ForbiddenException(
        'Only Tech Lead, CEO or Admin can manage workspace integrations.',
      );
    }
  }

  @Get([':provider', ':provider/'])
  @ApiOperation({ summary: 'Read a workspace integration (secrets are never returned)' })
  async read(@Param('provider') provider: string, @CurrentUser() user: any) {
    this.authorize(user, provider);
    return (await bridgeGet(this.http, user, `/api/integrations/${provider}/`)).data;
  }

  @Post([':provider/connect', ':provider/connect/'])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save workspace integration settings' })
  async connect(
    @Param('provider') provider: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: any,
  ) {
    this.authorize(user, provider);
    return (await bridgePost(this.http, user, `/api/integrations/${provider}/connect/`, body)).data;
  }

  @Post([':provider/test', ':provider/test/'])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Test workspace integration credentials' })
  async test(
    @Param('provider') provider: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: any,
  ) {
    this.authorize(user, provider);
    return (await bridgePost(this.http, user, `/api/integrations/${provider}/test/`, body)).data;
  }
}
