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

it('fetches task traces scoped to organization or 404s', async () => {
  const { service, prisma } = setup();
  await expect(service.getTracesForTask(999, { id: 7 })).rejects.toThrow('organization');

  prisma.task.findFirst.mockResolvedValue(null as any);
  await expect(service.getTracesForTask(999, user)).rejects.toThrow('not found');

  prisma.task.findFirst.mockResolvedValue({ id: 11, organizationId: 3 } as any);
  prisma.agentExecutionTrace.findMany.mockResolvedValue([
    {
      id: 42,
      taskId: 11,
      sessionId: 'sess-1',
      status: 'completed',
      graphState: {},
      steps: [],
      tokensUsed: 100,
      costUsd: { toNumber: () => 0.05 },
      durationSeconds: 12.5,
      langfuseUrl: 'https://langfuse.local/t/42',
      createdAt: new Date('2026-09-06T12:00:00Z'),
      finishedAt: new Date('2026-09-06T12:01:00Z'),
      task: { title: 'Ticket 11', projectId: 5, project: { name: 'Demo Proj' } },
    },
  ] as any);

  const traces = await service.getTracesForTask(11, user);
  expect(traces).toHaveLength(1);
  expect(traces[0]).toMatchObject({
    id: 42,
    task: 11,
    task_title: 'Ticket 11',
    project_id: 5,
    project_name: 'Demo Proj',
    status: 'completed',
  });
});

it('executes swarm chain with privileged user and forwarded instruction', async () => {
  const { service, http } = setup();
  await expect(
    service.executeSwarmChain(11, 'Build feature', { ...user, role: 'member' }),
  ).rejects.toThrow('Only Tech Lead');

  const data = { message: 'Swarm chain queued', task_id: 11, task_status: 'in_progress', trace: { id: 30 } };
  http.axiosRef.post.mockResolvedValue({ status: 202, data });

  const res = await service.executeSwarmChain(11, 'Build feature', user);
  expect(res).toEqual(data);
  expect(http.axiosRef.post).toHaveBeenCalledWith(
    expect.stringContaining('/api/agents/swarm-chain/11/'),
    { instruction: 'Build feature' },
    expect.anything(),
  );
});

it('retrieves agent events and provides last_event_id', async () => {
  const { service, prisma } = setup();
  prisma.agentEvent.findMany.mockResolvedValue([
    {
      id: 101,
      sessionId: 's-1',
      eventType: 'step',
      senderKey: 'tech_lead',
      recipientKey: 'backend_core',
      message: 'Plan approved',
      currentWork: 'Writing backend',
      remainingWork: [],
      metadata: {},
      taskId: 11,
      projectId: 5,
      traceId: 42,
      createdAt: new Date('2026-09-06T12:00:00Z'),
      task: { title: 'Ticket 11' },
      project: { name: 'Demo Proj' },
      sender: { name: 'Sarah Jenkins', email: 'lead@teamflow.dev', role: 'tech_lead' },
    },
  ] as any);

  const res = await service.getEvents(user, { projectId: 5 });
  expect(res.events).toHaveLength(1);
  expect(res.last_event_id).toBe(101);
  expect(res.events[0].sender_name).toBe('Sarah Jenkins');
});

it('triggers RAG ingestion or falls back gracefully', async () => {
  const { service, http } = setup();
  await expect(
    service.ingestRAG(5, { ...user, role: 'member' }),
  ).rejects.toThrow('Only Tech Lead');

  http.axiosRef.post.mockResolvedValue({ status: 200, data: { message: 'Ingested', chunks_ingested: 10 } });
  const res = await service.ingestRAG(5, user);
  expect(res.chunks_ingested).toBe(10);
});

