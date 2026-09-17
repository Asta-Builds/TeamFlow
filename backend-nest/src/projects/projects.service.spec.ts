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

it('delegates pm_generate_tasks to the execution service', async () => {
  const mockProject = {
    id: 10,
    organizationId: 2,
    members: [{ userId: 4 }],
  };
  const prisma = {
    project: { findUnique: vi.fn().mockResolvedValue(mockProject) },
  };
  const http = {
    axiosRef: {
      post: vi.fn().mockResolvedValue({
        status: 200,
        data: { ok: true, tasks_created_count: 5, pm_summary: 'Delegated' },
      }),
    },
  };
  
  vi.stubEnv('PYTHON_AI_JWT_SECRET', 'e'.repeat(48));
  vi.stubEnv('PYTHON_AI_SERVICE_URL', 'https://exec.example');

  const service = new ProjectsService(prisma as any, http as any);
  const res = await service.pmGenerateTasks(10, 'Build auth', { id: 4, organizationId: 2 });

  expect(http.axiosRef.post).toHaveBeenCalledWith(
    'https://exec.example/api/projects/10/pm_generate_tasks/',
    { plan: 'Build auth' },
    expect.any(Object)
  );
  expect(res.ok).toBe(true);
  expect(res.tasks_created_count).toBe(5);
  
  vi.unstubAllEnvs();
});

it('throws 503 when execution service fails with network error', async () => {
  const mockProject = {
    id: 10,
    organizationId: 2,
    members: [{ userId: 4 }],
  };
  const prisma = { project: { findUnique: vi.fn().mockResolvedValue(mockProject) } };
  const http = { axiosRef: { post: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) } };
  
  vi.stubEnv('PYTHON_AI_JWT_SECRET', 'e'.repeat(48));
  vi.stubEnv('PYTHON_AI_SERVICE_URL', 'https://exec.example');

  const service = new ProjectsService(prisma as any, http as any);
  await expect(service.pmGenerateTasks(10, 'Build auth', { id: 4, organizationId: 2 }))
    .rejects.toMatchObject({ status: 503 });
    
  vi.unstubAllEnvs();
});

describe('devopsCreateRepo', () => {
  const owner = { id: 4, role: 'member', organizationId: 2 };
  function setup(project: any = { id: 1, organizationId: 2, ownerId: 4 }) {
    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue(project),
        update: vi.fn(),
      },
    };
    const http = { axiosRef: { post: vi.fn() } };
    return { prisma, http, service: new ProjectsService(prisma as any, http as any) };
  }
  beforeEach(() => {
    vi.stubEnv('PYTHON_AI_JWT_SECRET', 'e'.repeat(48));
    vi.stubEnv('PYTHON_AI_SERVICE_URL', 'https://exec.example');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects other workspaces and non-owners before provisioning', async () => {
    const other = setup({ id: 1, organizationId: 9, ownerId: 4 });
    await expect(other.service.devopsCreateRepo(1, {}, owner)).rejects.toThrow('Access denied');
    expect(other.http.axiosRef.post).not.toHaveBeenCalled();

    const notOwner = setup({ id: 1, organizationId: 2, ownerId: 99 });
    await expect(notOwner.service.devopsCreateRepo(1, {}, owner)).rejects.toThrow('project owner');
    expect(notOwner.http.axiosRef.post).not.toHaveBeenCalled();
  });

  it('never links a simulated repository when provisioning fails', async () => {
    const { service, prisma, http } = setup();
    http.axiosRef.post.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(service.devopsCreateRepo(1, { org: 'example-org' }, owner)).rejects.toMatchObject({ status: 503 });

    http.axiosRef.post.mockResolvedValue({ status: 503, data: { ok: false, error: 'GitHub is not configured' } });
    await expect(service.devopsCreateRepo(1, {}, owner)).rejects.toThrow('GitHub is not configured');
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('returns the provisioning result from the execution service', async () => {
    const { service, http } = setup();
    const data = { ok: true, full_name: 'example-org/app', pushed: true };
    http.axiosRef.post.mockResolvedValue({ status: 200, data });
    await expect(service.devopsCreateRepo(1, {}, owner)).resolves.toEqual(data);
  });
});
