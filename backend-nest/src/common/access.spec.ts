import { TasksService } from '../tasks/tasks.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { PulseService } from '../pulse/pulse.service.js';
import { DeploymentsService } from '../deployments/deployments.service.js';
import { SeoService } from '../seo/seo.service.js';
import { BillingService } from '../billing/billing.service.js';
import { visibleTasks, visibleProjects } from './access.js';

const member = { id: 1, organizationId: 10, role: 'member' };
const admin = { ...member, role: 'admin' };
function setup() {
  const prisma = {
    task: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    comment: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
    taskActivity: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
    project: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: { count: vi.fn().mockResolvedValue(0) },
    pulsePlanItem: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    pulseFocusSession: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    deployment: { findUnique: vi.fn(), create: vi.fn() },
    sEOAudit: { create: vi.fn() },
    organization: {
      update: vi
        .fn()
        .mockResolvedValue({
          subscriptionTier: 'growth',
          subscriptionStatus: 'active',
        }),
    },
  };
  return {
    prisma,
    tasks: new TasksService(prisma as any),
    projects: new ProjectsService(prisma as any),
    pulse: new PulseService(prisma as any),
  };
}

it('requires tenant and project membership for ordinary users', () => {
  expect(visibleProjects(member)).toEqual({
    organizationId: 10,
    OR: [{ ownerId: 1 }, { members: { some: { userId: 1 } } }],
  });
  expect(visibleProjects(admin)).toEqual({ organizationId: 10 });
});
it.each([
  'tasks',
  'mine',
  'feed',
  'comments',
  'plans',
  'deployments',
  'audits',
])('fails closed for tenantless %s requests', async (operation) => {
  const { prisma, tasks, pulse } = setup();
  const user = { ...admin, organizationId: null };
  const calls: Record<string, () => Promise<unknown>> = {
    tasks: () => tasks.findAll(user),
    mine: () => tasks.getMyTasks(user),
    feed: () => tasks.getFeed(user),
    comments: () => tasks.getComments(user),
    plans: () => pulse.getPlanItems(user),
    deployments: () => new DeploymentsService(prisma as any).findAll(user),
    audits: () => new SeoService(prisma as any).findAll(user),
  };
  await expect(calls[operation]()).rejects.toThrow('organization');
  expect(prisma.task.findMany).not.toHaveBeenCalled();
  expect(prisma.comment.findMany).not.toHaveBeenCalled();
});
it('scopes comments and activity feeds even without a task filter', async () => {
  const { tasks, prisma } = setup();
  await tasks.getComments(member);
  await tasks.getFeed(member);
  expect(prisma.comment.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { task: visibleTasks(member) } }),
  );
  expect(prisma.taskActivity.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { task: visibleTasks(member) } }),
  );
});
it.each(['detail', 'comment', 'update', 'remove', 'validate', 'reject'])(
  'denies inaccessible task %s without writing',
  async (operation) => {
    const { tasks, prisma } = setup();
    const calls: Record<string, () => Promise<unknown>> = {
      detail: () => tasks.findOne(99, admin),
      comment: () => tasks.addComment(99, 'hello', admin),
      update: () => tasks.update(99, { title: 'changed' }, admin),
      remove: () => tasks.remove(99, admin),
      validate: () => tasks.qaValidate(99, admin),
      reject: () => tasks.qaReject(99, 'failed', admin),
    };
    await expect(calls[operation]()).rejects.toThrow('not found');
    expect(prisma.task.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 99, ...visibleTasks(admin) } }),
    );
    expect(prisma.task.update).not.toHaveBeenCalled();
    expect(prisma.task.delete).not.toHaveBeenCalled();
    expect(prisma.comment.create).not.toHaveBeenCalled();
  },
);
it('rejects task creation against a foreign or private project', async () => {
  const { tasks, prisma } = setup();
  await expect(
    tasks.create({ project: 99, title: 'test' }, member),
  ).rejects.toThrow('Project not found');
  expect(prisma.project.findFirst).toHaveBeenCalledWith({
    where: { id: 99, ...visibleProjects(member) },
  });
  expect(prisma.task.create).not.toHaveBeenCalled();
});
it('rejects a foreign assignee before creating or updating a task', async () => {
  const { tasks, prisma } = setup();
  prisma.project.findFirst.mockResolvedValue({ id: 2 } as any);
  prisma.task.findFirst.mockResolvedValue({
    id: 2,
    organizationId: 10,
    createdById: 1,
  } as any);
  await expect(
    tasks.create({ project: 2, title: 'test', assignee: 99 }, admin),
  ).rejects.toThrow('Users must belong');
  await expect(tasks.update(2, { assignee: 99 }, member)).rejects.toThrow(
    'Users must belong',
  );
  expect(prisma.task.create).not.toHaveBeenCalled();
  expect(prisma.task.update).not.toHaveBeenCalled();
});
it.each([
  { status: 'done' },
  { qa_rejected: false },
  { contract_compliance_score: 100 },
])('prevents ordinary owners writing QA results %j', async (dto) => {
  const { tasks, prisma } = setup();
  prisma.task.findFirst.mockResolvedValue({
    id: 2,
    organizationId: 10,
    createdById: 1,
  } as any);
  await expect(tasks.update(2, dto, member)).rejects.toThrow('Only QA');
  expect(prisma.task.update).not.toHaveBeenCalled();
});
it('rejects edits by a member who neither owns nor is assigned the task', async () => {
  const { tasks, prisma } = setup();
  prisma.task.findFirst.mockResolvedValue({
    organizationId: 10,
    createdById: 8,
    assigneeId: 9,
  } as any);
  await expect(tasks.update(2, { title: 'changed' }, member)).rejects.toThrow(
    'Only the assignee',
  );
});
it('requires the QA stage and constrains the successful mutation to that stage', async () => {
  const { tasks, prisma } = setup();
  prisma.task.findFirst.mockResolvedValue({ status: 'todo' } as any);
  await expect(tasks.qaValidate(2, admin)).rejects.toThrow(
    'Only tickets in QA',
  );
  expect(prisma.task.update).not.toHaveBeenCalled();
  prisma.task.findFirst.mockResolvedValue({ status: 'qa' } as any);
  prisma.task.update.mockResolvedValue({
    id: 2,
    status: 'done',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  expect((await tasks.qaValidate(2, admin)).status).toBe('done');
  expect(prisma.task.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 2, organizationId: 10, status: 'qa' },
    }),
  );
});
it('validates membership before creation or replacement, then uses a single nested write', async () => {
  const { projects, prisma } = setup();
  prisma.project.findUnique.mockResolvedValue({
    id: 2,
    organizationId: 10,
    ownerId: 1,
  });
  await expect(
    projects.create({ name: 'project', members: [99] }, admin),
  ).rejects.toThrow('Users must belong');
  await expect(projects.update(2, { members: [99] }, admin)).rejects.toThrow(
    'Users must belong',
  );
  expect(prisma.project.create).not.toHaveBeenCalled();
  expect(prisma.project.update).not.toHaveBeenCalled();
  prisma.user.count.mockResolvedValue(1);
  prisma.project.update.mockResolvedValue({
    id: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await projects.update(2, { name: 'new name', members: [3, 3] }, admin);
  expect(prisma.project.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        name: 'new name',
        members: { deleteMany: {}, create: [{ userId: 3 }] },
      }),
    }),
  );
});
it('rejects inaccessible tasks in personal plans and another users plan item in focus sessions', async () => {
  const { pulse, prisma } = setup();
  await expect(
    pulse.createPlanItem(member, { task: 99, date: '2026-09-05' }),
  ).rejects.toThrow('Task not found');
  await expect(
    pulse.startFocusSession(member, { plan_item: 99 }),
  ).rejects.toThrow('Plan item not found');
  expect(prisma.pulsePlanItem.findFirst).toHaveBeenCalledWith({
    where: {
      id: 99,
      userId: 1,
      organizationId: 10,
      task: visibleTasks(member),
    },
  });
  expect(prisma.pulsePlanItem.create).not.toHaveBeenCalled();
  expect(prisma.pulseFocusSession.create).not.toHaveBeenCalled();
});
it('executes deployment, rollback and SEO audit with real providers', async () => {
  const { prisma } = setup();
  prisma.project.findFirst.mockResolvedValue({ id: 2, organizationId: 10 } as any);
  prisma.project.findUnique.mockResolvedValue({ id: 2, organizationId: 10, name: 'Test' } as any);
  prisma.deployment.findUnique.mockResolvedValue({
    id: 5,
    projectId: 2,
    organizationId: 10,
    commitSha: 'abc1234',
    branch: 'main',
    environment: 'staging',
    project: { id: 2, name: 'Test' },
  });
  prisma.deployment.create.mockImplementation((args: any) => Promise.resolve({
    id: 10,
    ...args.data,
    startedAt: new Date(),
    finishedAt: new Date(),
    project: { name: 'Test' },
    triggeredBy: { name: 'Admin', email: 'admin@example.com' },
  }));
  prisma.sEOAudit.create.mockImplementation((args: any) => Promise.resolve({
    id: 20,
    ...args.data,
    performanceScore: args.data.performanceScore,
    seoScore: args.data.seoScore,
    mobileScore: args.data.mobileScore,
    loadTimeMs: args.data.loadTimeMs,
    createdAt: new Date(),
  }));

  const httpMock = {
    axiosRef: {
      get: vi.fn().mockResolvedValue({
        data: '<html><head><title>A Great Title For Testing Purposes Here</title><meta name="description" content="A comprehensive meta description that explains the platform and product offerings thoroughly."><meta name="viewport" content="width=device-width"></head><body><h1>Main Title</h1><img src="pic.jpg" alt="test"></body></html>',
      }),
      head: vi.fn().mockResolvedValue({ status: 200 }),
    },
  };

  const service = new DeploymentsService(prisma as any);
  const deployRes = await service.create({ project: 2 }, admin);
  expect(deployRes.status).toBe('success');
  expect(prisma.deployment.create).toHaveBeenCalled();

  const rollbackRes = await service.rollback(5, admin);
  expect(rollbackRes.status).toBe('rolled_back');

  const seoService = new SeoService(prisma as any, httpMock as any);
  const auditRes = await seoService.create({ url: 'https://example.com' }, admin);
  expect(auditRes.score).toBeGreaterThan(0);
  expect(prisma.sEOAudit.create).toHaveBeenCalled();
});
it('rejects foreign rollback targets', async () => {
  const { prisma } = setup();
  prisma.deployment.findUnique.mockResolvedValue({
    id: 5,
    projectId: 2,
    organizationId: 20,
  });
  await expect(
    new DeploymentsService(prisma as any).rollback(5, admin),
  ).rejects.toThrow('not found');
  expect(prisma.deployment.create).not.toHaveBeenCalled();
});
describe('mock billing', () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each(['production', ''])(
    'disables writes in %s even with the flag enabled',
    async (environment) => {
      vi.stubEnv('NODE_ENV', environment);
      vi.stubEnv('ALLOW_MOCK_BILLING', 'true');
      const { prisma } = setup();
      await expect(
        new BillingService(prisma as any).mockConfirm(admin),
      ).rejects.toThrow('mock billing is disabled');
      expect(prisma.organization.update).not.toHaveBeenCalled();
    },
  );
  it('requires explicit development opt-in and labels the result as simulated', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ALLOW_MOCK_BILLING', 'false');
    const { prisma } = setup();
    const billing = new BillingService(prisma as any);
    await expect(billing.mockConfirm(admin)).rejects.toThrow(
      'mock billing is disabled',
    );
    expect(prisma.organization.update).not.toHaveBeenCalled();
    vi.stubEnv('ALLOW_MOCK_BILLING', 'true');
    expect(await billing.mockConfirm(admin)).toMatchObject({
      mock: true,
      tier: 'growth',
    });
  });
});
