import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';
import { InviteMemberDto } from './dto/invite-member.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@ApiTags('organizations')
@Controller('organizations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class OrganizationsController {
  constructor(private organizationsService: OrganizationsService) {}

  @Get('current')
  @ApiOperation({ summary: 'Retrieve current active workspace organization details and metrics' })
  async getCurrent(@CurrentUser() user: any) {
    return this.organizationsService.getCurrent(user);
  }

  @Get('me')
  @ApiOperation({ summary: 'Alias for current workspace organization details' })
  async getMe(@CurrentUser() user: any) {
    return this.organizationsService.getCurrent(user);
  }

  @Get()
  @ApiOperation({ summary: 'List all organizations accessible to current user' })
  async findAll(@CurrentUser() user: any) {
    return this.organizationsService.findAll(user);
  }

  @Patch('current')
  @ApiOperation({ summary: 'Update current workspace organization settings (Admin/CEO/TechLead)' })
  async updateCurrent(
    @CurrentUser() user: any,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.updateCurrent(user, dto);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new tenant organization workspace' })
  async create(
    @CurrentUser() user: any,
    @Body() dto: CreateOrganizationDto,
  ) {
    return this.organizationsService.create(user, dto);
  }

  @Post('switch/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Switch active tenant workspace context and rotate JWT tokens' })
  async switchOrganization(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.organizationsService.switchOrganization(user, id);
  }

  @Post('invite')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Invite a new team member to current workspace organization' })
  async inviteMember(
    @CurrentUser() user: any,
    @Body() dto: InviteMemberDto,
  ) {
    return this.organizationsService.inviteMember(user, dto);
  }
}
