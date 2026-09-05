import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

export interface WorkspaceUser {
  id: number;
  organizationId?: number | null;
  role: string;
  isStaff?: boolean;
  isSuperuser?: boolean;
}

export function requireOrganization(user: WorkspaceUser): number {
  if (!user.organizationId)
    throw new ForbiddenException('An organization is required');
  return user.organizationId;
}

export function isPrivileged(user: WorkspaceUser): boolean {
  return Boolean(
    user.isStaff ||
    user.isSuperuser ||
    ['ceo', 'tech_lead', 'admin'].includes(user.role),
  );
}

export function visibleProjects(user: WorkspaceUser): Prisma.ProjectWhereInput {
  return {
    organizationId: requireOrganization(user),
    ...(!isPrivileged(user) && {
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    }),
  };
}

export function visibleTasks(user: WorkspaceUser): Prisma.TaskWhereInput {
  return {
    organizationId: requireOrganization(user),
    project: visibleProjects(user),
  };
}

export async function requireProject(
  prisma: PrismaService,
  id: number,
  user: WorkspaceUser,
) {
  const project = await prisma.project.findFirst({
    where: { id, ...visibleProjects(user) },
  });
  if (!project) throw new NotFoundException('Project not found');
  return project;
}

export async function requireTenantUsers(
  prisma: PrismaService,
  ids: number[],
  user: WorkspaceUser,
) {
  const organizationId = requireOrganization(user);
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 1))
    throw new BadRequestException('Invalid user IDs');
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return;
  const count = await prisma.user.count({
    where: { id: { in: uniqueIds }, organizationId },
  });
  if (count !== uniqueIds.length)
    throw new BadRequestException('Users must belong to your organization');
}
