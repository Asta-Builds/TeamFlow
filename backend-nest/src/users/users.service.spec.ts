import { UsersService } from './users.service.js';

const workspace = { id: 2, name: 'Acme', subscriptionTier: 'starter', subscriptionStatus: 'active' };
const member = { id: 1, role: 'member', organizationId: 2 };
const owner = { id: 9, role: 'ceo', organizationId: 2 };

function person(overrides: any = {}) {
  return {
    id: 3,
    email: 'person@acme.test',
    name: 'Person',
    role: 'ceo',
    agentKey: '',
    organizationId: 7,
    userStatus: 'active',
    isActive: true,
    dateJoined: new Date('2026-01-01T00:00:00Z'),
    memberships: [{ organizationId: 2, role: 'member', status: 'active' }],
    assignedTasks: [{ status: 'done' }, { status: 'todo' }],
    ...overrides,
  };
}

function prismaWith(user: any, extra: any = {}) {
  const prisma: any = {
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
      findMany: vi.fn().mockResolvedValue([user]),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(user),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    organization: { findUnique: vi.fn().mockResolvedValue(workspace) },
    membership: {
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue({ id: 5, organizationId: 2, role: 'member' }),
      update: vi.fn().mockResolvedValue({ id: 5, organizationId: 2, role: 'admin' }),
    },
    ...extra,
  };
  prisma.$transaction = vi.fn((fn: any) => fn(prisma));
  return prisma;
}

it.each([{ is_active: false }, { role: 'admin' }, { user_status: 'disabled' }])(
  'prevents members changing protected fields %j',
  async (dto) => {
    const prisma = prismaWith({ ...person({ id: 1 }) });
    await expect(
      new UsersService(prisma).update(1, dto, member),
    ).rejects.toThrow('Only workspace admins');
    expect(prisma.user.update).not.toHaveBeenCalled();
  },
);

it('prevents editing another member profile', async () => {
  const prisma = prismaWith(person());
  await expect(
    new UsersService(prisma).update(3, { bio: 'changed' }, member),
  ).rejects.toThrow();
  expect(prisma.user.update).not.toHaveBeenCalled();
});

it('does not expose another user to an account without a tenant', async () => {
  const prisma = prismaWith(person({ memberships: [] }));
  await expect(
    new UsersService(prisma).findOne(3, { ...member, organizationId: null }),
  ).rejects.toThrow('Access denied');
});

it('does not expose people from other workspaces', async () => {
  const prisma = prismaWith(person({ memberships: [] }));
  await expect(new UsersService(prisma).findOne(3, owner)).rejects.toThrow('Access denied');
});

it('reports the role and task counts of the viewing workspace', async () => {
  const prisma = prismaWith(person());
  const rows = await new UsersService(prisma).findAll(member);

  const query = prisma.user.findMany.mock.calls[0][0];
  expect(query.include.memberships.where).toEqual({ organizationId: 2 });
  expect(query.include.assignedTasks.where).toEqual({ organizationId: 2 });
  expect(query.where.AND[0]).toEqual({
    OR: [
      { agentKey: '', memberships: { some: { organizationId: 2 } } },
      { agentKey: 'pm', organizationId: 2 },
    ],
  });
  expect(rows[0]).toMatchObject({
    role: 'member',
    is_ai_agent: false,
    membership_status: 'active',
    organization: 2,
    organization_name: 'Acme',
    open_tasks_count: 1,
    closed_tasks_count: 1,
  });
});

it('changes roles through the workspace seat', async () => {
  const prisma = prismaWith(person());
  await new UsersService(prisma).update(3, { role: 'admin' }, owner);
  expect(prisma.membership.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { role: 'admin' } });
  expect(prisma.user.updateMany).toHaveBeenCalledWith({
    where: { id: 3, organizationId: 2 },
    data: { role: 'admin' },
  });
  expect(prisma.user.update).not.toHaveBeenCalled();
});

it('refuses AI roles for people', async () => {
  const prisma = prismaWith(person());
  await expect(new UsersService(prisma).update(3, { role: 'backend' }, owner)).rejects.toThrow(
    'Unsupported role',
  );
  expect(prisma.membership.update).not.toHaveBeenCalled();
});

it('protects the profile of people who belong to other workspaces', async () => {
  const prisma = prismaWith(person());
  prisma.membership.count.mockResolvedValue(1);
  await expect(
    new UsersService(prisma).update(3, { user_status: 'disabled' }, owner),
  ).rejects.toThrow('other workspaces');
  expect(prisma.user.update).not.toHaveBeenCalled();
});

it('keeps admins from editing owner and admin accounts', async () => {
  const prisma = prismaWith(person({ memberships: [{ organizationId: 2, role: 'ceo', status: 'active' }] }));
  await expect(
    new UsersService(prisma).update(3, { is_active: false }, { ...owner, role: 'admin' }),
  ).rejects.toThrow('workspace owners');
  expect(prisma.user.update).not.toHaveBeenCalled();
});

it('lets admins update accounts that belong only to their workspace', async () => {
  const prisma = prismaWith(person());
  await new UsersService(prisma).update(3, { user_status: 'offline' }, owner);
  expect(prisma.membership.count).toHaveBeenCalledWith({
    where: { userId: 3, organizationId: { not: 2 } },
  });
  expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { userStatus: 'offline' } });
});

it('creates people with a seat and a workspace role', async () => {
  const prisma = prismaWith(person(), {});
  prisma.user.findUnique = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(person());
  prisma.user.create = vi.fn().mockResolvedValue({ id: 3 });
  const service = new UsersService(prisma);

  await expect(
    service.create({ email: 'a@acme.test', password: 'secret-pass', role: 'qa' }, owner),
  ).rejects.toThrow('Unsupported role');
  await expect(
    service.create({ email: 'a@acme.test', password: 'secret-pass', role: 'admin' }, { ...owner, role: 'admin' }),
  ).rejects.toThrow('workspace owners');

  await service.create({ email: 'A@acme.test', password: 'secret-pass' }, owner);
  expect(prisma.user.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      email: 'a@acme.test',
      role: 'member',
      organizationId: 2,
      memberships: { create: { organizationId: 2, role: 'member', invitedById: 9 } },
    }),
  });
});
