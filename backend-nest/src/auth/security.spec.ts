import { pbkdf2Sync } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service.js';
import { JwtStrategy } from './jwt.strategy.js';
import { hashPassword, verifyPassword, requireSecret } from './security.js';

const djangoHash = `pbkdf2_sha256$1000$salt$${pbkdf2Sync('correct-password', 'salt', 1000, 32, 'sha256').toString('base64')}`;

beforeEach(() => {
  vi.stubEnv('JWT_SECRET', 'a'.repeat(48));
  vi.stubEnv('JWT_REFRESH_SECRET', 'b'.repeat(48));
});
afterEach(() => vi.unstubAllEnvs());

describe('shared password verification', () => {
  it('verifies Django hashes and rejects incorrect passwords', async () => {
    expect(await verifyPassword('correct-password', djangoHash)).toBe(true);
    expect(await verifyPassword('password', djangoHash)).toBe(false);
    expect(await verifyPassword('password123', djangoHash)).toBe(false);
  });
  it('supports existing bcrypt accounts', async () => {
    expect(
      await verifyPassword(
        'correct-password',
        await bcrypt.hash('correct-password', 4),
      ),
    ).toBe(true);
  });
  it.each([
    'plaintext',
    '!unusable',
    'pbkdf2_sha256$0$salt$bad',
    'pbkdf2_sha256$10000001$salt$bad',
  ])('rejects unsupported or malformed hash %s', async (encoded) => {
    expect(await verifyPassword(encoded, encoded)).toBe(false);
  });
  it('writes a Django-compatible hash', async () => {
    const encoded = await hashPassword('new-password');
    const [algorithm, iterations, salt, digest] = encoded.split('$');
    expect(algorithm).toBe('pbkdf2_sha256');
    expect(
      pbkdf2Sync(
        'new-password',
        salt,
        Number(iterations),
        32,
        'sha256',
      ).toString('base64'),
    ).toBe(digest);
  });
});

describe('authentication boundaries', () => {
  it('does not authenticate inactive accounts', async () => {
    const prisma = {
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ isActive: false, password: djangoHash }),
      },
    };
    const service = new AuthService(prisma as any, new JwtService());
    await expect(
      service.login({
        email: 'user@example.com',
        password: 'correct-password',
      }),
    ).rejects.toThrow('Invalid email or password');
  });
  it('ignores a supplied privileged role and creates a separate tenant atomically', async () => {
    const tx = {
      organization: { create: vi.fn().mockResolvedValue({ id: 42 }) },
      user: {
        create: vi.fn().mockResolvedValue({
          id: 2,
          email: 'new@example.com',
          role: 'member',
        }),
      },
    };
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((fn) => fn(tx)),
    };
    const service = new AuthService(prisma as any, new JwtService());
    vi.spyOn(service, 'serializeUser').mockResolvedValue(null);
    await service.register({
      email: 'new@example.com',
      password: 'secure-password',
      role: 'admin',
    } as any);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'ceo', organizationId: 42 }),
      }),
    );
  });
  it('keeps access and refresh tokens distinct', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 1, isActive: true }),
      },
    };
    const jwt = new JwtService();
    const service = new AuthService(prisma as any, jwt);
    const tokens = service.generateTokens(1, 'user@example.com', 'member');
    expect(
      jwt.verify(tokens.access, { secret: process.env.JWT_SECRET }).token_type,
    ).toBe('access');
    expect(
      jwt.verify(tokens.refresh, { secret: process.env.JWT_REFRESH_SECRET })
        .token_type,
    ).toBe('refresh');
    await expect(service.refresh({ refresh: tokens.access })).rejects.toThrow();
    await expect(
      new JwtStrategy(prisma as any).validate({
        user_id: 1,
        token_type: 'refresh',
      }),
    ).rejects.toThrow();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
  it.each(['', 'short', 'teamflow-secret-key-super-secure-change-in-prod'])(
    'rejects missing or known default secrets',
    (secret) => {
      vi.stubEnv('JWT_SECRET', secret);
      expect(() => requireSecret('JWT_SECRET')).toThrow();
    },
  );
});
