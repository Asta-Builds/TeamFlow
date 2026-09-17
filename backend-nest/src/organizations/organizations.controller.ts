import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
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
import { UpdateMemberRoleDto } from './dto/update-member-role.dto.js';
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
  @ApiOperation({ summary: 'List the workspaces and pending invitations of the current user' })
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
  @ApiOperation({ summary: 'Switch the active workspace (accepting a pending invitation) and rotate JWT tokens' })
  async switchOrganization(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.organizationsService.switchOrganization(user, id);
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Leave a workspace or decline an invitation to it' })
  async leave(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.organizationsService.leaveOrganization(user, id);
  }

  @Patch('current/members/:userId')
  @ApiOperation({ summary: "Change a person's role in the current workspace (CEO/Admin)" })
  async updateMemberRole(
    @CurrentUser() user: any,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.organizationsService.updateMemberRole(user, userId, dto.role);
  }

  @Delete('current/members/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a person or pending invitation from the current workspace (CEO/Admin)' })
  async removeMember(
    @CurrentUser() user: any,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    return this.organizationsService.removeMember(user, userId);
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
