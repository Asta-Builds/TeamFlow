import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { isPrivileged, requireOrganization, type WorkspaceUser } from './access.js';

/**
 * Roles a person can hold in a workspace. Specialist roles (pm, tech_lead,
 * backend, ...) belong to AI agent seats, which live in exactly one workspace
 * and never have memberships.
 */
export const HUMAN_ROLES = ['ceo', 'admin', 'member'] as const;
export type HumanRole = (typeof HUMAN_ROLES)[number];
export const MANAGER_ROLES: readonly string[] = ['ceo', 'admin'];

type Db = Prisma.TransactionClient;

export function isHumanRole(role: unknown): role is HumanRole {
  return typeof role === 'string' && (HUMAN_ROLES as readonly string[]).includes(role);
}

/** Map a stored or identity-provider role onto a role a person can hold. */
export function humanRoleFor(role: string | null | undefined): HumanRole {
  if (isHumanRole(role)) return role;
  return role === 'tech_lead' ? 'admin' : 'member';
}

export function unsupportedRole(role: string): BadRequestException {
  return new BadRequestException(
    `Unsupported role: ${role}. People can be ceo, admin or member; specialist roles belong to AI agents`,
  );
}

export function isPlatformStaff(
  user: { isStaff?: boolean; isSuperuser?: boolean } | null | undefined,
): boolean {
  return Boolean(user?.isStaff || user?.isSuperuser);
}

/** Workspace owners (CEOs) and platform staff manage owner and admin seats. */
export function isWorkspaceOwner(user: WorkspaceUser): boolean {
  return isPlatformStaff(user) || user.role === 'ceo';
}

/** Agent seats use `<key>+organization-<id>@<AGENT_EMAIL_DOMAIN>`; people cannot. */
export function isReservedAgentEmail(email: string): boolean {
  let domain = (process.env.AGENT_EMAIL_DOMAIN || '').trim().toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(domain)) domain = 'teamflow.dev';
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  return (
    normalized.slice(at + 1) === domain &&
    /^[a-z0-9_.-]+\+organization-\d+$/.test(normalized.slice(0, at))
  );
}

/** Placeholder accounts created for invitations to emails without an account. */
export const INVITED_PASSWORD_PREFIX = '!invited_';

export function isUnclaimedInvitee(user: {
  password: string;
  clerkId: string | null;
  agentKey: string;
  organizationId: number | null;
}): boolean {
  return (
    user.password.startsWith(INVITED_PASSWORD_PREFIX) &&
    !user.clerkId &&
    !user.agentKey &&
    user.organizationId === null
  );
}

export function personalWorkspaceName(name: string | null | undefined, email: string): string {
  return `${name || email.split('@')[0]}'s workspace`;
}

/** Active seats, in the shape `withActiveSeat` expects. */
export const ACTIVE_SEATS = {
  where: { status: 'active' },
  select: { organizationId: true, role: true },
} satisfies Prisma.User$membershipsArgs;

interface SeatHolder extends WorkspaceUser {
  agentKey?: string;
  memberships?: { organizationId: number; role: string }[];
}

/**
 * Take a person's role from their seat in the active workspace. The user row
 * caches the active workspace; without a seat there, access fails closed.
 */
export function withActiveSeat<T extends SeatHolder>(user: T): T {
  if (user.agentKey || isPlatformStaff(user) || !user.organizationId) return user;
  const seat = user.memberships?.find((m) => m.organizationId === user.organizationId);
  return Object.assign(user, seat ? { role: seat.role } : { organizationId: null, role: 'member' });
}

interface SignInUser {
  id: number;
  email: string;
  name: string;
  role: string;
  organizationId: number | null;
  userStatus: string;
  isStaff?: boolean;
  isSuperuser?: boolean;
}

/**
 * Settle a person's active workspace at sign-in: keep the current one while they
 * hold a seat there, otherwise move to their oldest seat, and found a personal
 * workspace when they have none.
 */
export async function ensureActiveWorkspace<T extends SignInUser>(db: Db, user: T): Promise<T> {
  const seats = await db.membership.findMany({
    where: { userId: user.id, status: 'active' },
    orderBy: { createdAt: 'asc' },
    select: { organizationId: true, role: true },
  });
  const seat = seats.find((s) => s.organizationId === user.organizationId) ?? seats[0];
  const data: Prisma.UserUncheckedUpdateInput = {};
  if (user.userStatus === 'pending') data.userStatus = 'active';
  if (seat) {
    if (seat.organizationId !== user.organizationId) data.organizationId = seat.organizationId;
    if (seat.role !== user.role) data.role = seat.role;
  } else if (!(isPlatformStaff(user) && user.organizationId)) {
    const org = await db.organization.create({
      data: { name: personalWorkspaceName(user.name, user.email) },
    });
    Object.assign(data, {
      organizationId: org.id,
      role: 'ceo',
      memberships: { create: { organizationId: org.id, role: 'ceo' } },
    });
  }
  if (!Object.keys(data).length) return user;
  return (await db.user.update({ where: { id: user.id }, data })) as unknown as T;
}

function assertCanManageSeat(actor: WorkspaceUser, currentRole: string, nextRole?: string) {
  const touchesManagers =
    MANAGER_ROLES.includes(currentRole) || (nextRole !== undefined && MANAGER_ROLES.includes(nextRole));
  if (touchesManagers && !isWorkspaceOwner(actor)) {
    throw new ForbiddenException('Only workspace owners can grant or revoke owner or admin roles');
  }
}

async function assertAnotherOwner(db: Db, organizationId: number, userId: number) {
  const owners = await db.membership.count({
    where: { organizationId, role: 'ceo', status: 'active', userId: { not: userId } },
  });
  if (!owners) {
    throw new ConflictException('A workspace needs at least one owner; make someone else CEO first');
  }
}

/** The last active CEO cannot leave or be removed. */
export async function assertCanLeave(
  db: Db,
  seat: { organizationId: number; userId: number; role: string; status: string },
) {
  if (seat.role === 'ceo' && seat.status === 'active') {
    await assertAnotherOwner(db, seat.organizationId, seat.userId);
  }
}

async function requireSeat(db: Db, organizationId: number, userId: number) {
  const seat = await db.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  });
  if (seat) return seat;
  const agent = await db.user.findFirst({
    where: { id: userId, organizationId, agentKey: { not: '' } },
    select: { id: true },
  });
  if (agent) throw new BadRequestException('AI agent seats are managed by the platform');
  throw new NotFoundException('This person is not a member of your workspace');
}

/** Change a person's role in the actor's workspace. */
export async function changeMemberRole(db: Db, actor: WorkspaceUser, targetId: number, role: string) {
  const organizationId = requireOrganization(actor);
  if (!isPrivileged(actor)) {
    throw new ForbiddenException('Only workspace admins can change member roles');
  }
  if (!isHumanRole(role)) throw unsupportedRole(role);
  if (targetId === actor.id) throw new ForbiddenException('You cannot change your own role');

  const seat = await requireSeat(db, organizationId, targetId);
  assertCanManageSeat(actor, seat.role, role);
  if (seat.role === 'ceo' && role !== 'ceo') {
    await assertAnotherOwner(db, organizationId, targetId);
  }
  const updated = await db.membership.update({ where: { id: seat.id }, data: { role } });
  await db.user.updateMany({ where: { id: targetId, organizationId }, data: { role } });
  return updated;
}

/** Remove a person (or a pending invitation) from the actor's workspace. */
export async function removeMember(db: Db, actor: WorkspaceUser, targetId: number) {
  const organizationId = requireOrganization(actor);
  if (!isPrivileged(actor)) {
    throw new ForbiddenException('Only workspace admins can remove members');
  }
  if (targetId === actor.id) {
    throw new BadRequestException('Leave the workspace instead of removing yourself');
  }
  const seat = await requireSeat(db, organizationId, targetId);
  assertCanManageSeat(actor, seat.role);
  await assertCanLeave(db, seat);
  return endSeat(db, seat);
}

/**
 * Delete a seat, drop the person's project access in that workspace, and move
 * them to another workspace if it was their active one.
 */
export async function endSeat(db: Db, seat: { id: number; userId: number; organizationId: number }) {
  await db.membership.delete({ where: { id: seat.id } });
  await db.projectMember.deleteMany({
    where: { userId: seat.userId, project: { organizationId: seat.organizationId } },
  });
  const user = await db.user.findUniqueOrThrow({ where: { id: seat.userId } });
  if (user.organizationId !== seat.organizationId) return user;
  const next = await db.membership.findFirst({
    where: { userId: seat.userId, status: 'active' },
    orderBy: { createdAt: 'asc' },
  });
  return db.user.update({
    where: { id: seat.userId },
    data: { organizationId: next?.organizationId ?? null, role: next?.role ?? 'member' },
  });
}
