import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';
import { InviteMemberDto } from './dto/invite-member.dto.js';
import { randomUUID } from 'node:crypto';

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

  private getTierLimits(tier: string) {
    switch (tier) {
      case 'enterprise':
        return {
          max_projects: 100,
          max_seats: 50,
          ai_agent_swarm: true,
          unlimited_traces: true,
          dedicated_clerk_sso: true,
          sla_support: true,
        };
      case 'scale':
        return {
          max_projects: 50,
          max_seats: 25,
          ai_agent_swarm: true,
          unlimited_traces: true,
          dedicated_clerk_sso: true,
          sla_support: false,
        };
      case 'growth':
        return {
          max_projects: 20,
          max_seats: 10,
          ai_agent_swarm: true,
          unlimited_traces: false,
          dedicated_clerk_sso: true,
          sla_support: false,
        };
      case 'starter':
      default:
        return {
          max_projects: 3,
          max_seats: 3,
          ai_agent_swarm: false,
          unlimited_traces: false,
          dedicated_clerk_sso: false,
          sla_support: false,
        };
    }
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
      this.prisma.user.count({ where: { organizationId: org.id } }),
      this.prisma.project.count({ where: { organizationId: org.id } }),
      this.prisma.task.count({ where: { organizationId: org.id } }),
      this.prisma.task.count({
        where: { organizationId: org.id, status: { not: 'done' } },
      }),
      this.prisma.deployment.count({ where: { organizationId: org.id } }),
      this.prisma.sEOAudit.count({ where: { organizationId: org.id } }),
    ]);

    return {
      id: org.id,
      name: org.name,
      subscription_tier: org.subscriptionTier,
      subscription_status: org.subscriptionStatus,
      created_at: org.createdAt.toISOString(),
      metrics: {
        members_count: membersCount,
        projects_count: projectsCount,
        tasks_count: tasksCount,
        open_tasks_count: openTasksCount,
        deployments_count: deploymentsCount,
        seo_audits_count: seoAuditsCount,
      },
      limits: this.getTierLimits(org.subscriptionTier),
    };
  }

  async findAll(user: any) {
    if (
      user.isSuperuser ||
      user.isStaff ||
      user.role === 'admin' ||
      user.role === 'ceo'
    ) {
      const allOrgs = await this.prisma.organization.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return allOrgs.map((org) => ({
        id: org.id,
        name: org.name,
        subscription_tier: org.subscriptionTier,
        subscription_status: org.subscriptionStatus,
        is_current: org.id === user.organizationId,
        created_at: org.createdAt.toISOString(),
      }));
    }

    const userOrgs = await this.prisma.organization.findMany({
      where: {
        OR: [
          { id: user.organizationId ?? -1 },
          {
            projects: {
              some: {
                OR: [
                  { ownerId: user.id },
                  { members: { some: { userId: user.id } } },
                ],
              },
            },
          },
          { tasks: { some: { createdById: user.id } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    return userOrgs.map((org) => ({
      id: org.id,
      name: org.name,
      subscription_tier: org.subscriptionTier,
      subscription_status: org.subscriptionStatus,
      is_current: org.id === user.organizationId,
      created_at: org.createdAt.toISOString(),
    }));
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

    return {
      id: org.id,
      name: org.name,
      subscription_tier: org.subscriptionTier,
      subscription_status: org.subscriptionStatus,
      created_at: org.createdAt.toISOString(),
    };
  }

  async create(user: any, dto: CreateOrganizationDto) {
    const tier = dto.tier || 'starter';
    const org = await this.prisma.organization.create({
      data: {
        name: dto.name.trim(),
        subscriptionTier: tier,
        subscriptionStatus: 'active',
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

    const tokens = this.authService.generateTokens(user.id, user.email, 'ceo');
    const serializedUser = await this.authService.serializeUser(user.id);

    return {
      organization: {
        id: org.id,
        name: org.name,
        subscription_tier: org.subscriptionTier,
        subscription_status: org.subscriptionStatus,
        created_at: org.createdAt.toISOString(),
      },
      ...tokens,
      user: serializedUser,
    };
  }

  async switchOrganization(user: any, orgId: number) {
    if (!orgId || orgId < 1) {
      throw new BadRequestException('Invalid organization ID');
    }

    const targetOrg = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });

    if (!targetOrg) {
      throw new NotFoundException(`Organization #${orgId} not found`);
    }

    // Verify tenant access permissions
    let hasAccess =
      user.isSuperuser ||
      user.isStaff ||
      user.role === 'ceo' ||
      user.role === 'admin';

    if (!hasAccess) {
      const existingMember = await this.prisma.user.findFirst({
        where: {
          organizationId: orgId,
          email: user.email.toLowerCase(),
        },
      });
      if (existingMember) {
        hasAccess = true;
      }
    }

    if (!hasAccess) {
      const associatedProject = await this.prisma.project.findFirst({
        where: {
          organizationId: orgId,
          OR: [
            { ownerId: user.id },
            { members: { some: { userId: user.id } } },
          ],
        },
      });
      if (associatedProject) {
        hasAccess = true;
      }
    }

    if (!hasAccess) {
      const associatedTask = await this.prisma.task.findFirst({
        where: {
          organizationId: orgId,
          createdById: user.id,
        },
      });
      if (associatedTask) {
        hasAccess = true;
      }
    }

    if (!hasAccess) {
      // Check if domain matches organization convention
      const domain = user.email.split('@')[1]?.toLowerCase();
      const orgNameLower = targetOrg.name.toLowerCase();
      const domainPrefix = domain?.split('.')[0];
      const isDomainMatch =
        domainPrefix && orgNameLower.includes(domainPrefix);

      if (isDomainMatch) {
        hasAccess = true;
      }
    }

    if (!hasAccess) {
      throw new ForbiddenException(
        `You do not have access to switch to workspace "${targetOrg.name}"`,
      );
    }

    // Switch tenant context
    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        organizationId: targetOrg.id,
      },
    });

    const tokens = this.authService.generateTokens(
      updatedUser.id,
      updatedUser.email,
      updatedUser.role,
    );
    const serializedUser = await this.authService.serializeUser(updatedUser.id);

    return {
      message: `Switched active workspace to ${targetOrg.name}`,
      organization: {
        id: targetOrg.id,
        name: targetOrg.name,
        subscription_tier: targetOrg.subscriptionTier,
        subscription_status: targetOrg.subscriptionStatus,
      },
      ...tokens,
      user: serializedUser,
    };
  }

  async inviteMember(user: any, dto: InviteMemberDto) {
    if (!user.organizationId) {
      throw new NotFoundException('An active workspace organization is required');
    }

    if (!this.isPrivileged(user)) {
      throw new ForbiddenException(
        'Only workspace administrators can invite team members',
      );
    }

    const email = dto.email.trim().toLowerCase();
    const role = dto.role || 'member';

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      if (existingUser.organizationId === user.organizationId) {
        throw new ConflictException(
          'User is already a member of this workspace organization',
        );
      }
      // Re-assign or add to workspace
      const updated = await this.prisma.user.update({
        where: { id: existingUser.id },
        data: {
          organizationId: user.organizationId,
          role,
        },
      });
      return {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        user_status: updated.userStatus,
        organization_id: updated.organizationId,
        message: 'Existing user linked to workspace',
      };
    }

    const unusablePassword = `!invited_${randomUUID()}`;
    const name = dto.name || email.split('@')[0];
    const newUser = await this.prisma.user.create({
      data: {
        email,
        password: unusablePassword,
        name,
        role,
        organizationId: user.organizationId,
        userStatus: 'pending',
        avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(email)}`,
      },
    });

    return {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
      user_status: newUser.userStatus,
      organization_id: newUser.organizationId,
      message: 'Invitation sent and member provisioned',
    };
  }
}
