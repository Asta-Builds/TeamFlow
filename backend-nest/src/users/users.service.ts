import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  private isPrivileged(user: any): boolean {
    return (
      user.isStaff ||
      user.isSuperuser ||
      ['ceo', 'tech_lead', 'admin'].includes(user.role)
    );
  }

  private mapUser(user: any) {
    const assigned = user.assignedTasks || [];
    const openCount = assigned.filter((t: any) => t.status !== 'done').length;
    const closedCount = assigned.filter((t: any) => t.status === 'done').length;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      agent_key: user.agentKey,
      is_ai_agent: Boolean(user.agentKey),
      user_status: user.userStatus,
      avatar_url: user.avatarUrl,
      bio: user.bio,
      is_active: user.isActive,
      date_joined: user.dateJoined ? user.dateJoined.toISOString() : new Date().toISOString(),
      organization: user.organizationId,
      organization_name: user.organization?.name,
      organization_tier: user.organization?.subscriptionTier ?? 'starter',
      organization_status: user.organization?.subscriptionStatus ?? 'active',
      open_tasks_count: openCount,
      closed_tasks_count: closedCount,
    };
  }

  async findAll(currentUser: any, query?: { role?: string; user_status?: string; search?: string }) {
    const where: any = {};
    if (currentUser.organizationId) {
      where.organizationId = currentUser.organizationId;
    } else {
      where.id = currentUser.id;
    }

    if (query?.role) {
      where.role = query.role;
    }
    if (query?.user_status) {
      where.userStatus = query.user_status;
    }
    if (query?.search) {
      where.OR = [
        { email: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const users = await this.prisma.user.findMany({
      where,
      include: {
        organization: true,
        assignedTasks: {
          select: { status: true },
        },
      },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
    });

    return users.map((u) => this.mapUser(u));
  }

  async findOne(id: number, currentUser: any) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        organization: true,
        assignedTasks: {
          select: { status: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    if (currentUser.organizationId && user.organizationId !== currentUser.organizationId) {
      throw new ForbiddenException('Access denied across tenants');
    }

    return this.mapUser(user);
  }

  async create(dto: CreateUserDto, currentUser: any) {
    if (!this.isPrivileged(currentUser)) {
      throw new ForbiddenException('Only Tech Lead, CEO or Admin can add members');
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const created = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        password: hashedPassword,
        name: dto.name || dto.email.split('@')[0],
        role: dto.role || 'member',
        userStatus: dto.user_status || 'active',
        organizationId: currentUser.organizationId,
        avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(dto.email)}`,
      },
      include: {
        organization: true,
        assignedTasks: true,
      },
    });

    return this.mapUser(created);
  }

  async update(id: number, dto: UpdateUserDto, currentUser: any) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    if (currentUser.organizationId && user.organizationId !== currentUser.organizationId) {
      throw new ForbiddenException('Access denied across tenants');
    }

    if ((dto.role || dto.user_status) && !this.isPrivileged(currentUser)) {
      throw new ForbiddenException('Only Tech Lead, CEO or Admin can change member roles/status');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.user_status !== undefined && { userStatus: dto.user_status }),
        ...(dto.avatar_url !== undefined && { avatarUrl: dto.avatar_url }),
        ...(dto.bio !== undefined && { bio: dto.bio }),
        ...(dto.is_active !== undefined && { isActive: dto.is_active }),
      },
      include: {
        organization: true,
        assignedTasks: true,
      },
    });

    return this.mapUser(updated);
  }
}
