import { IntegrationsController } from './integrations.controller.js';

const lead = { id: 3, organizationId: 8, role: 'tech_lead' };

function setup() {
  const http = { axiosRef: { get: vi.fn(), post: vi.fn() } };
  return { http, controller: new IntegrationsController(http as any) };
}

beforeEach(() => {
  vi.stubEnv('PYTHON_AI_JWT_SECRET', 'f'.repeat(48));
  vi.stubEnv('PYTHON_AI_SERVICE_URL', 'https://exec.example');
});
afterEach(() => vi.unstubAllEnvs());

it('forwards reads and writes for privileged users', async () => {
  const { http, controller } = setup();
  http.axiosRef.get.mockResolvedValue({ status: 200, data: { github_token_configured: true } });
  http.axiosRef.post.mockResolvedValue({ status: 200, data: { ok: true } });

  await expect(controller.read('github', lead)).resolves.toEqual({ github_token_configured: true });
  await expect(controller.connect('slack', { default_channel: '#eng' }, lead)).resolves.toEqual({ ok: true });
  expect(http.axiosRef.get.mock.calls[0][0]).toBe('https://exec.example/api/integrations/github/');
  expect(http.axiosRef.post.mock.calls[0][0]).toBe('https://exec.example/api/integrations/slack/connect/');
});

it('rejects members, tenantless users, and unknown providers without forwarding', async () => {
  const { http, controller } = setup();
  await expect(controller.read('github', { ...lead, role: 'member' })).rejects.toThrow('Only Tech Lead');
  await expect(controller.read('github', { ...lead, organizationId: null })).rejects.toThrow('organization');
  await expect(controller.read('../agents', lead)).rejects.toThrow('Unknown integration');
  expect(http.axiosRef.get).not.toHaveBeenCalled();
});

it('passes validation errors through and hides upstream failures', async () => {
  const { http, controller } = setup();
  http.axiosRef.post.mockResolvedValue({ status: 400, data: { ok: false, detail: 'Bad token' } });
  await expect(controller.test('github', {}, lead)).rejects.toMatchObject({ status: 400 });
  http.axiosRef.post.mockResolvedValue({ status: 500, data: 'boom' });
  await expect(controller.test('github', {}, lead)).rejects.toMatchObject({ status: 502 });
});
