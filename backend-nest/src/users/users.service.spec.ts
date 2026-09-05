import { UsersService } from './users.service.js';

const member = { id: 1, role: 'member', organizationId: 2 };
it.each([{ is_active: false }, { role: 'admin' }, { user_status: 'disabled' }])(
  'prevents members changing protected fields %j',
  async (dto) => {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue(member), update: vi.fn() },
    };
    await expect(
      new UsersService(prisma as any).update(1, dto, member),
    ).rejects.toThrow('Only Tech Lead');
    expect(prisma.user.update).not.toHaveBeenCalled();
  },
);
it('prevents editing another member profile', async () => {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue({ ...member, id: 3 }),
      update: vi.fn(),
    },
  };
  await expect(
    new UsersService(prisma as any).update(3, { bio: 'changed' }, member),
  ).rejects.toThrow();
  expect(prisma.user.update).not.toHaveBeenCalled();
});
it('does not expose another user to an account without a tenant', async () => {
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue({ ...member, id: 3 }) },
  };
  await expect(
    new UsersService(prisma as any).findOne(3, {
      ...member,
      organizationId: null,
    }),
  ).rejects.toThrow('Access denied');
});
