import { ProjectsService } from './projects.service.js';

it('intersects search with membership and tenant constraints', async () => {
  const prisma = { project: { findMany: vi.fn().mockResolvedValue([]) } };
  await new ProjectsService(prisma as any).findAll(
    { id: 4, role: 'member', organizationId: 2 },
    { search: 'private' },
  );
  const where = prisma.project.findMany.mock.calls[0][0].where;
  expect(where).toEqual({
    organizationId: 2,
    OR: [{ ownerId: 4 }, { members: { some: { userId: 4 } } }],
    AND: [
      {
        OR: [
          { name: { contains: 'private', mode: 'insensitive' } },
          { description: { contains: 'private', mode: 'insensitive' } },
        ],
      },
    ],
  });
});
it('does not list projects for a privileged user without a tenant', async () => {
  const prisma = { project: { findMany: vi.fn() } };
  expect(
    await new ProjectsService(prisma as any).findAll({ id: 4, role: 'admin' }),
  ).toEqual([]);
  expect(prisma.project.findMany).not.toHaveBeenCalled();
});
it('denies project detail access without a tenant', async () => {
  const prisma = {
    project: { findUnique: vi.fn().mockResolvedValue({ organizationId: 2 }) },
  };
  await expect(
    new ProjectsService(prisma as any).findOne(1, { id: 4, role: 'admin' }),
  ).rejects.toThrow('Access denied');
});
