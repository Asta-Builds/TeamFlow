import { AgentsService } from './agents.service.js';

const ceo = { id: 7, organizationId: 3, role: 'ceo' };
const admin = { id: 8, organizationId: 3, role: 'admin' };
const member = { id: 9, organizationId: 3, role: 'member' };
const techLead = { id: 10, organizationId: 3, role: 'tech_lead' };

function setup() {
  const prisma = {
    task: { findFirst: vi.fn() },
    agentEvent: { findMany: vi.fn(), create: vi.fn() },
    agentExecutionTrace: { findMany: vi.fn(), create: vi.fn() },
  };
  const http = { axiosRef: { post: vi.fn(), get: vi.fn() } };
  return {
    prisma,
    http,
    service: new AgentsService(prisma as any, http as any),
  };
}

beforeEach(() => {
  vi.stubEnv('PYTHON_AI_JWT_SECRET', 'c'.repeat(48));
  vi.stubEnv('PYTHON_AI_SERVICE_URL', 'https://ai.example');
});
afterEach(() => vi.unstubAllEnvs());

it('lists approvals through the Python service with the task filter', async () => {
  const { service, http } = setup();
  http.axiosRef.get.mockResolvedValue({ status: 200, data: [{ id: 1 }] });

  const result = await service.listApprovals(member, 12, 'pending');

  expect(result).toEqual([{ id: 1 }]);
  const [url, options] = http.axiosRef.get.mock.calls[0];
  expect(url).toBe(
    'https://ai.example/api/agents/approvals/?task=12&status=pending',
  );
  expect(options.headers.Authorization).toMatch(/^Bearer /);
});

it('lets a workspace owner and an admin approve', async () => {
  for (const user of [ceo, admin]) {
    const { service, http } = setup();
    http.axiosRef.post.mockResolvedValue({ status: 202, data: { id: 5 } });

    await service.approveRelease(user, 5, 'ship it');

    expect(http.axiosRef.post).toHaveBeenCalledWith(
      'https://ai.example/api/agents/approvals/5/approve/',
      { reason: 'ship it' },
      expect.objectContaining({ timeout: 10000 }),
    );
  }
});

it('refuses members and the tech lead seat before calling Python', async () => {
  for (const user of [member, techLead]) {
    const { service, http } = setup();
    await expect(service.approveRelease(user, 5, '')).rejects.toThrow(
      'workspace owner or admin',
    );
    await expect(service.rejectRelease(user, 5, 'no')).rejects.toThrow(
      'workspace owner or admin',
    );
    expect(http.axiosRef.post).not.toHaveBeenCalled();
  }
});

it('requires a reason to reject, without calling Python', async () => {
  const { service, http } = setup();
  await expect(service.rejectRelease(ceo, 5, '   ')).rejects.toMatchObject({
    status: 400,
    response: { detail: 'A reason is required to reject a release.' },
  });
  expect(http.axiosRef.post).not.toHaveBeenCalled();
});

it('rejects with a trimmed reason', async () => {
  const { service, http } = setup();
  http.axiosRef.post.mockResolvedValue({ status: 200, data: { id: 5 } });

  await service.rejectRelease(ceo, 5, '  needs a migration plan  ');

  expect(http.axiosRef.post).toHaveBeenCalledWith(
    'https://ai.example/api/agents/approvals/5/reject/',
    { reason: 'needs a migration plan' },
    expect.objectContaining({ timeout: 10000 }),
  );
});

it("passes Django's rejection status through", async () => {
  for (const status of [400, 403, 404, 409]) {
    const { service, http } = setup();
    http.axiosRef.post.mockRejectedValue({
      response: { status, data: { detail: 'nope' } },
    });
    await expect(service.approveRelease(ceo, 5, '')).rejects.toMatchObject({
      status,
    });
  }
});

it('never claims success when the decision could not be confirmed', async () => {
  const { service, http } = setup();
  http.axiosRef.post.mockRejectedValue(new Error('socket hang up'));

  await expect(service.approveRelease(ceo, 5, '')).rejects.toThrow(
    'could not be confirmed',
  );
});

it('requires an organization', async () => {
  const { service, http } = setup();
  await expect(
    service.listApprovals({ id: 7, role: 'ceo' } as any),
  ).rejects.toThrow('organization');
  expect(http.axiosRef.get).not.toHaveBeenCalled();
});
