import { RefreshTokenStore } from './refresh-token.store.js';

function sqlOf(call: any[]): string {
  return (call[0] as TemplateStringsArray).join('?').replace(/\s+/g, ' ').trim();
}

function setup() {
  const prisma = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  };
  return { prisma, store: new RefreshTokenStore(prisma as any) };
}

it('stores a fingerprint instead of the refresh token', async () => {
  const { prisma, store } = setup();
  await store.record('jti-1', 7, 'secret.refresh.token', new Date());
  const call = prisma.$executeRaw.mock.calls[0];
  expect(sqlOf(call)).toContain('INSERT INTO token_blacklist_outstandingtoken');
  expect(call.slice(1)).not.toContain('secret.refresh.token');
  expect(call[2]).toMatch(/^sha256:[0-9a-f]{64}$/);
});

it('reports unknown, active, and revoked sessions', async () => {
  const { prisma, store } = setup();
  expect(await store.status('missing')).toBe('unknown');
  prisma.$queryRaw.mockResolvedValueOnce([{ blacklisted: false }]);
  expect(await store.status('live')).toBe('active');
  prisma.$queryRaw.mockResolvedValueOnce([{ blacklisted: true }]);
  expect(await store.status('used')).toBe('revoked');
  expect(sqlOf(prisma.$queryRaw.mock.calls[0])).toContain('expires_at > NOW()');
});

it('consumes a refresh token only once', async () => {
  const { prisma, store } = setup();
  expect(await store.rotate('jti-1')).toBe(true);
  prisma.$executeRaw.mockResolvedValueOnce(0);
  expect(await store.rotate('jti-1')).toBe(false);
  expect(sqlOf(prisma.$executeRaw.mock.calls[0])).toContain('ON CONFLICT (token_id) DO NOTHING');
});

it('deletes blacklist rows before sessions and only touches NestJS rows', async () => {
  const { prisma, store } = setup();
  await store.endSession('jti-1');
  const [first, second] = prisma.$executeRaw.mock.calls.map(sqlOf);
  expect(first).toContain('DELETE FROM token_blacklist_blacklistedtoken');
  expect(second).toContain('DELETE FROM token_blacklist_outstandingtoken');
  expect(second).toContain("token LIKE 'sha256:%'");
  expect(prisma.$transaction).toHaveBeenCalledOnce();
});

it('ends all sessions and blacklists Django-issued tokens', async () => {
  const { prisma, store } = setup();
  await store.endAllSessions(7);
  const statements = prisma.$executeRaw.mock.calls.map(sqlOf);
  expect(statements).toHaveLength(3);
  expect(statements[2]).toContain('INSERT INTO token_blacklist_blacklistedtoken');
  expect(prisma.$executeRaw.mock.calls.every((call: any[]) => call.includes(7))).toBe(true);
});
