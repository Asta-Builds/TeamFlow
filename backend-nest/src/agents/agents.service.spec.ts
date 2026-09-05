import { JwtService } from '@nestjs/jwt';
import { AgentsService } from './agents.service.js';

const user = { id: 7, organizationId: 3, role: 'tech_lead' };
function setup() {
  const prisma = {
    task: {
      findFirst: vi.fn().mockResolvedValue({ id: 11, organizationId: 3 }),
    },
    agentEvent: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
    agentExecutionTrace: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
    },
  };
  const http = { axiosRef: { post: vi.fn(), get: vi.fn() } };
  return {
    prisma,
    http,
    service: new AgentsService(prisma as any, http as any),
  };
}
beforeEach(() => vi.stubEnv('PYTHON_AI_JWT_SECRET', 'c'.repeat(48)));
afterEach(() => vi.unstubAllEnvs());

it('rejects users without a tenant before querying feeds or traces', async () => {
  const { service, prisma } = setup();
  await expect(service.getSwarmFeed({ id: 7 })).rejects.toThrow('organization');
  await expect(service.getTraces({ id: 7 })).rejects.toThrow('organization');
  expect(prisma.agentEvent.findMany).not.toHaveBeenCalled();
  expect(prisma.agentExecutionTrace.findMany).not.toHaveBeenCalled();
});
it('rejects nonprivileged dispatches', async () => {
  const { service, http } = setup();
  await expect(
    service.dispatch(11, { ...user, role: 'member' }),
  ).rejects.toThrow('Only Tech Lead');
  expect(http.axiosRef.post).not.toHaveBeenCalled();
});
it('requires a task in the caller organization', async () => {
  const { service, prisma, http } = setup();
  prisma.task.findFirst.mockResolvedValue(null as any);
  await expect(service.dispatch(11, user)).rejects.toThrow('not found');
  expect(prisma.task.findFirst).toHaveBeenCalledWith({
    where: { id: 11, organizationId: 3 },
  });
  expect(http.axiosRef.post).not.toHaveBeenCalled();
});
it('authenticates as the caller and returns the real queued response', async () => {
  const { service, http } = setup();
  const data = { trace: { id: 20, status: 'queued' }, task_status: 'todo' };
  http.axiosRef.post.mockResolvedValue({ status: 202, data });
  expect(await service.dispatch(11, user)).toEqual(data);
  const options = http.axiosRef.post.mock.calls[0][2];
  const token = new JwtService().verify(
    options.headers.Authorization.slice(7),
    { secret: process.env.PYTHON_AI_JWT_SECRET },
  );
  expect(token).toMatchObject({ user_id: 7, token_type: 'access' });
  expect(token.jti).toBeTruthy();
  expect(token.exp - token.iat).toBe(60);
});
it.each([401, 403, 404, 500, 503, undefined])(
  'does not create fictional work after upstream failure %s',
  async (status) => {
    const { service, http, prisma } = setup();
    http.axiosRef.post.mockRejectedValue({ response: { status } });
    await expect(service.dispatch(11, user)).rejects.toThrow();
    expect(http.axiosRef.post).toHaveBeenCalledOnce();
    expect(prisma.agentEvent.create).not.toHaveBeenCalled();
    expect(prisma.agentExecutionTrace.create).not.toHaveBeenCalled();
  },
);
it('does not claim runtime health when Python is unavailable', async () => {
  const { service, http } = setup();
  http.axiosRef.get.mockRejectedValue(new Error('offline'));
  await expect(service.getStatus(user)).rejects.toThrow('Unable to verify');
});
