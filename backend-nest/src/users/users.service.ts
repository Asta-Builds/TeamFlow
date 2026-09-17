import { requireOrganization, isPrivileged } from '../common/access.js';
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import type { Organization, Prisma } from '@prisma/client';
import { hashPassword } from '../auth/security.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  MANAGER_ROLES,
  changeMemberRole,
  isHumanRole,
  isPlatformStaff,
  isReservedAgentEmail,
  isWorkspaceOwner,
  unsupportedRole,
} from '../common/workspace.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

type Seat = { role: string; status: string } | undefined;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  /** Seat and task counts for one workspace, so nothing leaks from others. */
  private workspaceInclude(organizationId: number) {
    return {
      memberships: {
        where: { organizationId },
        select: { organizationId: true, role: true, status: true },
      },
      assignedTasks: { where: { organizationId }, select: { status: true } },
    } satisfies Prisma.UserInclude;
  }

  /**
   * Serialize a user as seen from a workspace: the role is the one they hold
   * there, and the organization fields describe that workspace.
   */
  private mapUser(user: any, workspace: Organization | null | undefined, seat: Seat) {
    const assigned = user.assignedTasks || [];
    const openCount = assigned.filter((t: any) => t.status !== 'done').length;
    const closedCount = assigned.filter((t: any) => t.status === 'done').length;
    const org = workspace ?? user.organization;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: seat?.role ?? user.role,
      agent_key: user.agentKey,
      is_ai_agent: Boolean(user.agentKey),
      membership_status: user.agentKey ? null : (seat?.status ?? null),
      user_status: user.userStatus,
      avatar_url: user.avatarUrl,
      bio: user.bio,
      is_active: user.isActive,
      date_joined: user.dateJoined
        ? user.dateJoined.toISOString()
        : new Date().toISOString(),
      organization: org?.id ?? user.organizationId,
      organization_name: org?.name,
      organization_tier: org?.subscriptionTier ?? 'starter',
      organization_status: org?.subscriptionStatus ?? 'active',
      open_tasks_count: openCount,
      closed_tasks_count: closedCount,
    };
  }

  private belongsTo(user: any, organizationId: number | null | undefined): boolean {
    if (!organizationId) return false;
    return user.agentKey
      ? user.organizationId === organizationId
      : (user.memberships ?? []).some((m: any) => m.organizationId === organizationId);
  }

  private async findInWorkspace(id: number, currentUser: any) {
    const organizationId = currentUser.organizationId ?? -1;
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: this.workspaceInclude(organizationId),
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    if (user.id !== currentUser.id && !this.belongsTo(user, currentUser.organizationId)) {
      throw new ForbiddenException('Access denied across tenants');
    }
    return user;
  }

  private async serializeIn(id: number, currentUser: any) {
    const user = await this.findInWorkspace(id, currentUser);
    const workspace = currentUser.organizationId
      ? await this.prisma.organization.findUnique({ where: { id: currentUser.organizationId } })
      : null;
    return this.mapUser(user, workspace, user.memberships?.[0]);
  }

  async findAll(
    currentUser: any,
    query?: { role?: string; user_status?: string; search?: string },
  ) {
    const organizationId = currentUser.organizationId;
    if (!organizationId) {
      return [await this.serializeIn(currentUser.id, currentUser)];
    }

    // People with a seat here (including pending invitations) and Athena,
    // the workspace's AI project manager.
    const and: Prisma.UserWhereInput[] = [
      {
        OR: [
          { agentKey: '', memberships: { some: { organizationId } } },
          { agentKey: 'pm', organizationId },
        ],
      },
    ];
    if (query?.role) {
      and.push({
        OR: [
          { agentKey: '', memberships: { some: { organizationId, role: query.role } } },
          { agentKey: { not: '' }, role: query.role },
        ],
      });
    }
    if (query?.user_status) {
      and.push({ userStatus: query.user_status });
    }
    if (query?.search) {
      and.push({
        OR: [
          { email: { contains: query.search, mode: 'insensitive' } },
          { name: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }

    const [workspace, users] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: organizationId } }),
      this.prisma.user.findMany({
        where: { AND: and },
        include: this.workspaceInclude(organizationId),
        orderBy: [{ name: 'asc' }, { email: 'asc' }],
      }),
    ]);

    return users.map((u) => this.mapUser(u, workspace, u.memberships[0]));
  }

  async findOne(id: number, currentUser: any) {
    return this.serializeIn(id, currentUser);
  }

  async create(dto: CreateUserDto, currentUser: any) {
    const organizationId = requireOrganization(currentUser);
    if (!isPrivileged(currentUser)) {
      throw new ForbiddenException('Only workspace admins can add members');
    }
    const role = dto.role || 'member';
    if (!isHumanRole(role)) {
      throw unsupportedRole(role);
    }
    if (MANAGER_ROLES.includes(role) && !isWorkspaceOwner(currentUser)) {
      throw new ForbiddenException('Only workspace owners can grant owner or admin roles');
    }
    const email = dto.email.toLowerCase();
    if (isReservedAgentEmail(email)) {
      throw new BadRequestException('This email address is reserved for AI agent seats');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await hashPassword(dto.password);
    const created = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: dto.name || email.split('@')[0],
        role,
        userStatus: dto.user_status || 'active',
        organizationId,
        memberships: { create: { organizationId, role, invitedById: currentUser.id } },
      },
    });

    return this.serializeIn(created.id, currentUser);
  }

  /**
   * People edit their own profile. Workspace admins change roles in their
   * workspace, and edit accounts that belong only to it (agent seats and people
   * with no other workspace).
   */
  async update(id: number, dto: UpdateUserDto, currentUser: any) {
    const user = await this.findInWorkspace(id, currentUser);
    const isSelf = id === currentUser.id;

    const protectedChange =
      dto.role !== undefined ||
      dto.user_status !== undefined ||
      dto.is_active !== undefined;
    if (!isPrivileged(currentUser) && (!isSelf || protectedChange)) {
      throw new ForbiddenException(
        'Only workspace admins can change member roles, status or other profiles',
      );
    }

    const profile: Prisma.UserUpdateInput = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.user_status !== undefined && { userStatus: dto.user_status }),
      ...(dto.avatar_url !== undefined && { avatarUrl: dto.avatar_url }),
      ...(dto.bio !== undefined && { bio: dto.bio }),
      ...(dto.is_active !== undefined && { isActive: dto.is_active }),
    };
    const editsProfile = Object.keys(profile).length > 0;
    if (editsProfile && !isSelf && !isPlatformStaff(currentUser)) {
      const seatRole = user.memberships[0]?.role;
      const managesManager = seatRole !== undefined && MANAGER_ROLES.includes(seatRole);
      if (!user.agentKey && managesManager && !isWorkspaceOwner(currentUser)) {
        throw new ForbiddenException('Only workspace owners can edit owner or admin accounts');
      }
      const soleWorkspace = user.agentKey
        ? true
        : (await this.prisma.membership.count({
            where: { userId: id, organizationId: { not: currentUser.organizationId } },
          })) === 0;
      if (!soleWorkspace) {
        throw new ForbiddenException(
          'This person also belongs to other workspaces; only their role here can change',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      if (dto.role !== undefined) {
        await changeMemberRole(tx, currentUser, id, dto.role);
      }
      if (editsProfile) {
        await tx.user.update({ where: { id }, data: profile });
      }
    });

    return this.serializeIn(id, currentUser);
  }
}
