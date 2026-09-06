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

it('rejects pm_generate_tasks when plan is empty', async () => {
  const prisma = {};
  await expect(
    new ProjectsService(prisma as any).pmGenerateTasks(1, '   ', { id: 4, organizationId: 2 }),
  ).rejects.toThrow('A plan or feature prompt is required');
});

it('decomposes plan into 3 sprint tickets with agent assignments', async () => {
  const mockProject = {
    id: 10,
    name: 'TeamFlow Core',
    organizationId: 2,
    githubRepo: 'Asta-Builds/TeamFlow',
    members: [],
  };
  const mockAgent = { id: 99, name: 'Agent User', email: 'agent@teamflow.dev' };
  const mockTask = {
    id: 101,
    projectId: 10,
    title: 'Test Task',
    description: 'Test desc',
    status: 'todo',
    taskType: 'feature',
    priority: 'high',
    assigneeId: 99,
    assignee: mockAgent,
    createdById: 99,
    createdBy: mockAgent,
    createdAt: new Date(),
    updatedAt: new Date(),
    comments: [],
  };

  const prisma = {
    project: { findUnique: vi.fn().mockResolvedValue(mockProject) },
    user: {
      findFirst: vi.fn().mockResolvedValue(mockAgent),
      create: vi.fn().mockResolvedValue(mockAgent),
    },
    task: { create: vi.fn().mockResolvedValue(mockTask) },
    notification: { create: vi.fn().mockResolvedValue({}) },
  };

  const service = new ProjectsService(prisma as any);
  const res = await service.pmGenerateTasks(10, 'Build Keycloak JWT auth flow', {
    id: 4,
    organizationId: 2,
    role: 'ceo',
  });

  expect(res.ok).toBe(true);
  expect(res.tasks_created_count).toBe(3);
  expect(res.pm_summary).toContain('Athena (AI PM)');
  expect(prisma.task.create).toHaveBeenCalledTimes(3);
  expect(prisma.notification.create).toHaveBeenCalledTimes(1);
});
