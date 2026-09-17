import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import type { Organization } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';
import { InviteMemberDto } from './dto/invite-member.dto.js';
import { limitsForTier } from '../billing/plans.js';
import { randomUUID } from 'node:crypto';
import {
  INVITED_PASSWORD_PREFIX,
  MANAGER_ROLES,
  assertCanLeave,
  changeMemberRole,
  endSeat,
  ensureActiveWorkspace,
  isHumanRole,
  isPlatformStaff,
  isReservedAgentEmail,
  isWorkspaceOwner,
  removeMember,
  unsupportedRole,
  hasVerifiedEmail,
} from '../common/workspace.js';

function serializeOrganization(org: Organization) {
  return {
    id: org.id,
    name: org.name,
    subscription_tier: org.subscriptionTier,
    subscription_status: org.subscriptionStatus,
    created_at: org.createdAt.toISOString(),
  };
}

@Injectable()
export class OrganizationsService {
  constructor(
    private prisma: PrismaService,
    private authService: AuthService,
  ) {}

  private isPrivileged(user: any): boolean {
    return (
      user.isStaff ||
      user.isSuperuser ||
      ['ceo', 'tech_lead', 'admin'].includes(user.role)
    );
  }

  /** Return fresh tokens and the serialized user after a workspace change. */
  private async session(user: { id: number; email: string; role: string }) {
    const tokens = await this.authService.generateTokens(user.id, user.email, user.role);
    const serializedUser = await this.authService.serializeUser(user.id);
    return { ...tokens, user: serializedUser };
  }

  async getCurrent(user: any) {
    if (!user.organizationId) {
      throw new NotFoundException('User does not belong to an active organization');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: user.organizationId },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const [
      membersCount,
      projectsCount,
      tasksCount,
      openTasksCount,
      deploymentsCount,
      seoAuditsCount,
    ] = await Promise.all([
      // Seats are held by people; AI agents do not count against them.
      this.prisma.membership.count({ where: { organizationId: org.id, status: 'active' } }),
      this.prisma.project.count({ where: { organizationId: org.id } }),
      this.prisma.task.count({ where: { organizationId: org.id } }),
      this.prisma.task.count({
        where: { organizationId: org.id, status: { not: 'done' } },
      }),
      this.prisma.deployment.count({ where: { organizationId: org.id } }),
      this.prisma.sEOAudit.count({ where: { organizationId: org.id } }),
    ]);

    return {
      ...serializeOrganization(org),
      role: user.role,
      metrics: {
        members_count: membersCount,
        projects_count: projectsCount,
        tasks_count: tasksCount,
        open_tasks_count: openTasksCount,
        deployments_count: deploymentsCount,
        seo_audits_count: seoAuditsCount,
      },
      limits: limitsForTier(org.subscriptionTier),
    };
  }

  /** The caller's workspaces and pending invitations; platform staff see every workspace. */
  async findAll(user: any) {
    const seats = await this.prisma.membership.findMany({
      where: { userId: user.id },
      include: {
        organization: true,
        invitedBy: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const rows = seats.map((seat) => ({
      ...serializeOrganization(seat.organization),
      role: seat.role,
      membership_status: seat.status,
      invited_by: seat.invitedBy ? seat.invitedBy.name || seat.invitedBy.email : null,
      is_current: seat.status === 'active' && seat.organizationId === user.organizationId,
    }));
    if (!isPlatformStaff(user)) return rows;

    const seated = new Set(seats.map((seat) => seat.organizationId));
    const others = await this.prisma.organization.findMany({
      where: { id: { notIn: [...seated] } },
      orderBy: { createdAt: 'desc' },
    });
    return [
      ...rows,
      ...others.map((org) => ({
        ...serializeOrganization(org),
        role: null,
        membership_status: null,
        invited_by: null,
        is_current: org.id === user.organizationId,
      })),
    ];
  }

  async updateCurrent(user: any, dto: UpdateOrganizationDto) {
    if (!user.organizationId) {
      throw new NotFoundException('User does not belong to an active organization');
    }

    if (!this.isPrivileged(user)) {
      throw new ForbiddenException(
        'Only workspace administrators can modify organization settings',
      );
    }

    const updateData: any = {};
    if (dto.name?.trim()) {
      updateData.name = dto.name.trim();
    }

    const org = await this.prisma.organization.update({
      where: { id: user.organizationId },
      data: updateData,
    });

    return serializeOrganization(org);
  }

  /** Found a new workspace. The creator is its CEO and keeps their other workspaces. */
  async create(user: any, dto: CreateOrganizationDto) {
    // Paid tiers are granted only by the billing flow.
    const tier = isPlatformStaff(user) && dto.tier ? dto.tier : 'starter';
    const org = await this.prisma.organization.create({
      data: {
        name: dto.name.trim(),
        subscriptionTier: tier,
        subscriptionStatus: 'active',
        memberships: { create: { userId: user.id, role: 'ceo' } },
      },
    });

    // Switch the creator to this new workspace as CEO
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        organizationId: org.id,
        role: 'ceo',
      },
    });

    return {
      organization: serializeOrganization(org),
      ...(await this.session({ id: user.id, email: user.email, role: 'ceo' })),
    };
  }

  /** Make a workspace the active one. Switching to an invitation accepts it. */
  async switchOrganization(user: any, orgId: number) {
    if (!orgId || orgId < 1) {
      throw new BadRequestException('Invalid organization ID');
    }

    const seat = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId: orgId } },
      include: { organization: true },
    });
    // Only platform staff may enter a workspace without a seat. The workspace
    // name is not revealed to anyone else.
    if (!seat && !isPlatformStaff(user)) {
      throw new ForbiddenException('You do not have access to this workspace');
    }
    if (seat && seat.status === 'invited' && !hasVerifiedEmail(user)) {
      throw new ForbiddenException('Sign in with Clerk using this email address to accept the invitation');
    }
    const targetOrg =
      seat?.organization ??
      (await this.prisma.organization.findUnique({ where: { id: orgId } }));
    if (!targetOrg) {
      throw new NotFoundException('Workspace not found');
    }

    const role = seat?.role ?? user.role;
    const updatedUser = await this.prisma.$transaction(async (tx) => {
      if (seat && seat.status !== 'active') {
        await tx.membership.update({ where: { id: seat.id }, data: { status: 'active' } });
      }
      return tx.user.update({
        where: { id: user.id },
        data: { organizationId: targetOrg.id, role },
      });
    });

    return {
      message: `Switched active workspace to ${targetOrg.name}`,
      organization: serializeOrganization(targetOrg),
      ...(await this.session(updatedUser)),
    };
  }

  /** Leave a workspace, or decline an invitation to it. */
  async leaveOrganization(user: any, orgId: number) {
    const updatedUser = await this.prisma.$transaction(async (tx) => {
      const seat = await tx.membership.findUnique({
        where: { userId_organizationId: { userId: user.id, organizationId: orgId } },
      });
      if (!seat) {
        throw new NotFoundException('You are not a member of this workspace');
      }
      await assertCanLeave(tx, seat);
      const remaining = await endSeat(tx, seat);
      return ensureActiveWorkspace(tx, remaining);
    });
    return {
      message: 'You left the workspace',
      ...(await this.session(updatedUser)),
    };
  }

  async updateMemberRole(user: any, memberId: number, role: string) {
    const seat = await this.prisma.$transaction((tx) =>
      changeMemberRole(tx, user, memberId, role),
    );
    return { user_id: memberId, organization_id: seat.organizationId, role: seat.role };
  }

  async removeMember(user: any, memberId: number) {
    await this.prisma.$transaction((tx) => removeMember(tx, user, memberId));
    return { detail: 'Member removed from the workspace' };
  }

  /**
   * Invite a person. A new email gets an account that joins when they first sign
   * in; an existing account gets an invitation it must accept. Invitations never
   * move anyone out of another workspace.
   */
  async inviteMember(user: any, dto: InviteMemberDto) {
    const organizationId = user.organizationId;
    if (!organizationId) {
      throw new NotFoundException('An active workspace organization is required');
    }

    if (!this.isPrivileged(user)) {
      throw new ForbiddenException(
        'Only workspace administrators can invite team members',
      );
    }

    const email = dto.email.trim().toLowerCase();
    const role = (dto.role || 'member').trim();
    if (!isHumanRole(role)) {
      throw unsupportedRole(role);
    }
    if (MANAGER_ROLES.includes(role) && !isWorkspaceOwner(user)) {
      throw new ForbiddenException(
        'Only workspace owners can grant owner or admin roles',
      );
    }
    if (isReservedAgentEmail(email)) {
      throw new BadRequestException('This email address is reserved for AI agent seats');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { where: { organizationId } } },
    });

    if (existingUser) {
      if (existingUser.agentKey) {
        throw new ConflictException('This email belongs to an AI agent seat');
      }
      const [seat] = existingUser.memberships;
      if (seat) {
        throw new ConflictException(
          seat.status === 'invited'
            ? 'This person already has a pending invitation'
            : 'User is already a member of this workspace organization',
        );
      }
      await this.prisma.membership.create({
        data: {
          userId: existingUser.id,
          organizationId,
          role,
          status: 'invited',
          invitedById: user.id,
        },
      });
      return {
        id: existingUser.id,
        email: existingUser.email,
        name: existingUser.name,
        role,
        is_ai_agent: false,
        user_status: existingUser.userStatus,
        membership_status: 'invited',
        organization_id: organizationId,
        message: 'Invitation sent; it appears in their workspace list until they accept it',
      };
    }

    // A placeholder account holds the invitation until the person signs up with
    // this email; they found their own workspace and accept from there.
    const newUser = await this.prisma.user.create({
      data: {
        email,
        password: `${INVITED_PASSWORD_PREFIX}${randomUUID()}`,
        name: dto.name?.trim() || email.split('@')[0],
        role: 'member',
        userStatus: 'pending',
        memberships: {
          create: { organizationId, role, status: 'invited', invitedById: user.id },
        },
      },
    });

    return {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role,
      is_ai_agent: false,
      user_status: newUser.userStatus,
      membership_status: 'invited',
      organization_id: organizationId,
      message: 'Invitation created; they can accept it after signing up with this email',
    };
  }
}
