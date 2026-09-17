import { JwtService } from '@nestjs/jwt';
import { DeploymentsService } from './deployments.service.js';

const devops = { id: 5, organizationId: 3, role: 'devops' };
const djangoDeployment = {
  id: 44,
  project: 9,
  project_name: 'Payments',
  environment: 'staging',
  status: 'in_progress',
  commit_sha: 'abc1234',
  branch: 'main',
  logs: 'Deployment provider accepted the request (HTTP 202).',
  duration_seconds: 0,
  triggered_by: 5,
  triggered_by_detail: { name: 'Joan', email: 'joan@example.invalid' },
  started_at: '2026-09-16T10:00:00Z',
  finished_at: null,
};

function setup() {
  const prisma = {
    project: { findFirst: vi.fn().mockResolvedValue({ id: 9, organizationId: 3 }) },
    deployment: {
      findUnique: vi.fn().mockResolvedValue({ id: 40, organizationId: 3, projectId: 9 }),
      create: vi.fn(),
    },
  };
  const http = { axiosRef: { post: vi.fn() } };
  return { prisma, http, service: new DeploymentsService(prisma as any, http as any) };
}

beforeEach(() => {
  vi.stubEnv('PYTHON_AI_JWT_SECRET', 'd'.repeat(48));
  vi.stubEnv('PYTHON_AI_SERVICE_URL', 'https://exec.example/');
});
afterEach(() => vi.unstubAllEnvs());

it('rejects members before contacting the execution service', async () => {
  const { service, http } = setup();
  await expect(
    service.create({ project: 9 }, { ...devops, role: 'member' }),
  ).rejects.toThrow('Only DevOps');
  expect(http.axiosRef.post).not.toHaveBeenCalled();
});

it('requires a visible project in the caller workspace', async () => {
  const { service, prisma, http } = setup();
  prisma.project.findFirst.mockResolvedValue(null);
  await expect(service.create({ project: 9 }, devops)).rejects.toThrow('Project not found');
  expect(http.axiosRef.post).not.toHaveBeenCalled();
});

it('forwards the request as the caller and never writes its own record', async () => {
  const { service, prisma, http } = setup();
  http.axiosRef.post.mockResolvedValue({ status: 202, data: djangoDeployment });

  const result = await service.create(
    { project: 9, environment: 'staging', branch: 'main', commit_sha: 'abc1234' },
    devops,
  );

  expect(result).toMatchObject({ id: 44, status: 'in_progress', triggered_by_name: 'Joan' });
  expect(prisma.deployment.create).not.toHaveBeenCalled();
  const [url, body, options] = http.axiosRef.post.mock.calls[0];
  expect(url).toBe('https://exec.example/api/deployments/');
  expect(body).toEqual({ project: 9, environment: 'staging', branch: 'main', commit_sha: 'abc1234' });
  const token = new JwtService().verify(options.headers.Authorization.slice(7), {
    secret: process.env.PYTHON_AI_JWT_SECRET,
  });
  expect(token).toMatchObject({ user_id: 5, token_type: 'access' });
});

it('reports a missing provider as 503', async () => {
  const { service, http } = setup();
  http.axiosRef.post.mockResolvedValue({
    status: 503,
    data: { detail: "No deployment provider is configured for the 'staging' environment." },
  });
  await expect(service.create({ project: 9 }, devops)).rejects.toMatchObject({
    status: 503,
  });
});

it('reports a provider rejection as 502 with the recorded deployment', async () => {
  const { service, http } = setup();
  http.axiosRef.post.mockResolvedValue({
    status: 502,
    data: { ...djangoDeployment, status: 'failed' },
  });
  await expect(service.create({ project: 9 }, devops)).rejects.toMatchObject({
    status: 502,
    response: { deployment: { status: 'failed' } },
  });
});

it('treats an unreachable or misconfigured execution service as 503', async () => {
  const { service, http } = setup();
  http.axiosRef.post.mockRejectedValue(new Error('ECONNREFUSED'));
  await expect(service.create({ project: 9 }, devops)).rejects.toMatchObject({ status: 503 });

  http.axiosRef.post.mockResolvedValue({ status: 401, data: { detail: 'bad token' } });
  await expect(service.create({ project: 9 }, devops)).rejects.toMatchObject({ status: 503 });

  vi.stubEnv('PYTHON_AI_SERVICE_URL', '');
  await expect(service.create({ project: 9 }, devops)).rejects.toMatchObject({ status: 503 });
});

it('rolls back only deployments in the caller workspace', async () => {
  const { service, prisma, http } = setup();
  prisma.deployment.findUnique.mockResolvedValue({ id: 40, organizationId: 99, projectId: 9 });
  await expect(service.rollback(40, devops)).rejects.toThrow('not found');
  expect(http.axiosRef.post).not.toHaveBeenCalled();

  prisma.deployment.findUnique.mockResolvedValue({ id: 40, organizationId: 3, projectId: 9 });
  http.axiosRef.post.mockResolvedValue({ status: 202, data: djangoDeployment });
  await service.rollback(40, devops);
  expect(http.axiosRef.post.mock.calls[0][0]).toBe(
    'https://exec.example/api/deployments/40/rollback/',
  );
});
