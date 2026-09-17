import { pbkdf2Sync } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service.js';
import { JwtStrategy } from './jwt.strategy.js';
import { hashPassword, verifyPassword, requireSecret } from './security.js';

const djangoHash = `pbkdf2_sha256$1000$salt$${pbkdf2Sync('correct-password', 'salt', 1000, 32, 'sha256').toString('base64')}`;

function memoryStore() {
  const sessions = new Map<string, { userId: number; revoked: boolean }>();
  return {
    sessions,
    record: vi.fn(async (jti: string, userId: number) => {
      sessions.set(jti, { userId, revoked: false });
    }),
    status: vi.fn(async (jti: string) => {
      const session = sessions.get(jti);
      if (!session) return 'unknown';
      return session.revoked ? 'revoked' : 'active';
    }),
    rotate: vi.fn(async (jti: string) => {
      const session = sessions.get(jti);
      if (!session || session.revoked) return false;
      session.revoked = true;
      return true;
    }),
    endSession: vi.fn(async (jti: string) => {
      sessions.delete(jti);
    }),
    endAllSessions: vi.fn(async (userId: number) => {
      for (const [jti, session] of sessions) {
        if (session.userId === userId) sessions.delete(jti);
      }
    }),
  };
}

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
    const service = new AuthService(prisma as any, new JwtService(), undefined, undefined, memoryStore() as any);
    await expect(
      service.login({
        email: 'user@example.com',
        password: 'correct-password',
      }),
    ).rejects.toThrow('Invalid email or password');
  });
  it('never signs in AI agent seats', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 4,
          isActive: true,
          agentKey: 'qa',
          password: djangoHash,
        }),
      },
    };
    const service = new AuthService(prisma as any, new JwtService(), undefined, undefined, memoryStore() as any);
    await expect(
      service.login({ email: 'qa+organization-1@agents.test', password: 'correct-password' }),
    ).rejects.toThrow('Invalid email or password');
  });
  it('rejects sign-up with an address reserved for agent seats', async () => {
    vi.stubEnv('AGENT_EMAIL_DOMAIN', 'agents.test');
    const prisma = { user: { findUnique: vi.fn() }, $transaction: vi.fn() };
    const service = new AuthService(prisma as any, new JwtService(), undefined, undefined, memoryStore() as any);
    await expect(
      service.register({ email: 'PM+organization-3@Agents.test', password: 'secure-password' }),
    ).rejects.toThrow('reserved');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('refuses sign-up for an invitation placeholder', async () => {
    const placeholder = {
      id: 5,
      email: 'invitee@example.com',
      name: 'Invitee',
      password: '!invited_abc',
      clerkId: null,
      agentKey: '',
      organizationId: null,
    };
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue(placeholder) },
      $transaction: vi.fn(),
    };
    const service = new AuthService(prisma as any, new JwtService(), undefined, undefined, memoryStore() as any);
    await expect(
      service.register({ email: 'invitee@example.com', password: 'secure-password' }),
    ).rejects.toThrow('already exists');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('keeps real accounts from being claimed by sign-up', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 6,
          password: '!invited_abc',
          clerkId: null,
          agentKey: '',
          organizationId: 9,
        }),
      },
      $transaction: vi.fn(),
    };
    const service = new AuthService(prisma as any, new JwtService(), undefined, undefined, memoryStore() as any);
    await expect(
      service.register({ email: 'member@example.com', password: 'secure-password' }),
    ).rejects.toThrow('already exists');
    expect(prisma.$transaction).not.toHaveBeenCalled();
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
    const service = new AuthService(prisma as any, new JwtService(), undefined, undefined, memoryStore() as any);
    vi.spyOn(service, 'serializeUser').mockResolvedValue(null);
    await service.register({
      email: 'new@example.com',
      password: 'secure-password',
      role: 'admin',
    } as any);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: 'ceo',
          organizationId: 42,
          memberships: { create: { organizationId: 42, role: 'ceo' } },
        }),
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
    const store = memoryStore();
    const service = new AuthService(prisma as any, jwt, undefined, undefined, store as any);
    const tokens = await service.generateTokens(1, 'user@example.com', 'member');
    expect(
      jwt.verify(tokens.access, { secret: process.env.JWT_SECRET }).token_type,
    ).toBe('access');
    expect(
      jwt.verify(tokens.refresh, { secret: process.env.JWT_REFRESH_SECRET })
        .token_type,
    ).toBe('refresh');
    await expect(service.refresh({ refresh: tokens.access })).rejects.toThrow();
    await expect(
      new JwtStrategy(prisma as any, store as any).validate({
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

describe('session lifecycle', () => {
  const activeUser = { id: 1, email: 'user@example.com', role: 'member', isActive: true, password: djangoHash };
  function setup() {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue(activeUser),
        update: vi.fn().mockResolvedValue(activeUser),
      },
    };
    const jwt = new JwtService();
    const store = memoryStore();
    const service = new AuthService(prisma as any, jwt, undefined, undefined, store as any);
    const strategy = new JwtStrategy(prisma as any, store as any);
    const sidOf = (access: string) =>
      jwt.verify(access, { secret: process.env.JWT_SECRET }).sid as string;
    return { prisma, jwt, store, service, strategy, sidOf };
  }

  it('issues short-lived access tokens bound to a registered session', async () => {
    const { jwt, service, store, sidOf } = setup();
    const tokens = await service.generateTokens(1, 'user@example.com', 'member');
    const access = jwt.verify(tokens.access, { secret: process.env.JWT_SECRET });
    const refresh = jwt.verify(tokens.refresh, { secret: process.env.JWT_REFRESH_SECRET });
    expect(access.exp - access.iat).toBe(3600);
    expect(access.sid).toBe(refresh.jti);
    expect(store.sessions.get(sidOf(tokens.access))).toEqual({ userId: 1, revoked: false });
  });

  it('rotates refresh tokens and treats reuse as theft', async () => {
    const { service, strategy, sidOf } = setup();
    const first = await service.generateTokens(1, 'user@example.com', 'member');
    const second = await service.refresh({ refresh: first.refresh });

    await expect(service.refresh({ refresh: first.refresh })).rejects.toThrow('reuse detected');
    // The legitimate newer session is revoked as well.
    await expect(service.refresh({ refresh: second.refresh })).rejects.toThrow();
    await expect(
      strategy.validate({ user_id: 1, token_type: 'access', sid: sidOf(second.access) }),
    ).rejects.toThrow('Session has ended');
  });

  it('rejects refresh tokens that were never registered', async () => {
    const { jwt, service } = setup();
    const forged = jwt.sign(
      { user_id: 1, token_type: 'refresh', jti: 'not-registered' },
      { secret: process.env.JWT_REFRESH_SECRET },
    );
    await expect(service.refresh({ refresh: forged })).rejects.toThrow('Invalid refresh token');
  });

  it('rejects access tokens without an active session', async () => {
    const { strategy, prisma } = setup();
    await expect(strategy.validate({ user_id: 1, token_type: 'access' })).rejects.toThrow('Invalid token payload');
    await expect(
      strategy.validate({ user_id: 1, token_type: 'access', sid: 'unknown-session' }),
    ).rejects.toThrow('Session has ended');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('logout ends the current session and the supplied refresh token', async () => {
    const { service, strategy, sidOf } = setup();
    const current = await service.generateTokens(1, 'user@example.com', 'member');
    const other = await service.generateTokens(1, 'user@example.com', 'member');
    const principal = await strategy.validate({ user_id: 1, token_type: 'access', sid: sidOf(current.access) });

    await service.logout(principal as any, { refresh: other.refresh });

    await expect(service.refresh({ refresh: current.refresh })).rejects.toThrow();
    await expect(service.refresh({ refresh: other.refresh })).rejects.toThrow();
  });

  it("logout never revokes another user's refresh token", async () => {
    const { service, store } = setup();
    const victim = await service.generateTokens(2, 'victim@example.com', 'member');
    await service.logout({ id: 1 }, { refresh: victim.refresh });
    expect(store.sessions.size).toBe(1);
    expect(store.endSession).not.toHaveBeenCalled();
  });

  it('password change ends every session and returns a fresh one', async () => {
    const { service, strategy, store, sidOf } = setup();
    const old = await service.generateTokens(1, 'user@example.com', 'member');
    const result: any = await service.changePassword(1, {
      old_password: 'correct-password',
      new_password: 'a-new-strong-password',
    } as any);

    await expect(
      strategy.validate({ user_id: 1, token_type: 'access', sid: sidOf(old.access) }),
    ).rejects.toThrow('Session has ended');
    // Another device presenting its old token is refused without ending the new session.
    await expect(service.refresh({ refresh: old.refresh })).rejects.toThrow('Invalid refresh token');
    expect(store.endAllSessions).toHaveBeenCalledOnce();
    await expect(
      strategy.validate({ user_id: 1, token_type: 'access', sid: sidOf(result.access) }),
    ).resolves.toMatchObject({ id: 1 });
  });
});

describe('Clerk sign-in provisioning', () => {
  function setup(existing: { linked?: any; byEmail?: any; seats?: any[] } = {}) {
    const tx = {
      user: {
        findUnique: vi.fn(async ({ where }: any) =>
          where.clerkId ? existing.linked ?? null : existing.byEmail ?? null,
        ),
        create: vi.fn(async ({ data }: any) => ({ id: 9, isActive: true, ...data })),
        update: vi.fn(async ({ data }: any) => ({ ...(existing.linked ?? existing.byEmail), ...data })),
      },
      membership: {
        findMany: vi.fn().mockResolvedValue(existing.seats ?? []),
      },
      organization: {
        findFirst: vi.fn(),
        create: vi.fn(async ({ data }: any) => ({ id: 77, ...data })),
      },
    };
    const prisma = { $transaction: vi.fn((fn: any) => fn(tx)) };
    const clerk = {
      verifyClerkSession: vi.fn().mockResolvedValue({
        clerk_id: 'user_abc',
        email: 'person@gmail.com',
        name: 'Person',
      }),
    };
    const store = memoryStore();
    const service = new AuthService(prisma as any, new JwtService(), undefined, clerk as any, store as any);
    vi.spyOn(service, 'serializeUser').mockResolvedValue(null);
    return { tx, service, store };
  }

  it('gives new users their own workspace instead of joining one by name or domain', async () => {
    const { tx, service } = setup();
    await service.clerkLogin({ token: 'verified' });
    expect(tx.organization.findFirst).not.toHaveBeenCalled();
    expect(tx.organization.create).toHaveBeenCalledOnce();
    expect(tx.organization.create).toHaveBeenCalledWith({ data: { name: "Person's workspace" } });
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clerkId: 'user_abc',
          organizationId: 77,
          role: 'ceo',
          memberships: { create: { organizationId: 77, role: 'ceo' } },
        }),
      }),
    );
  });

  it('links an existing member to their verified Clerk identity', async () => {
    const member = {
      id: 3,
      email: 'person@gmail.com',
      name: 'Person',
      organizationId: 5,
      role: 'member',
      userStatus: 'active',
      password: '!invited_placeholder',
      clerkId: null,
      agentKey: '',
      isActive: true,
      avatarUrl: '',
    };
    const { tx, service } = setup({ byEmail: member, seats: [{ organizationId: 5, role: 'member' }] });
    await service.clerkLogin({ token: 'verified' });
    expect(tx.organization.create).not.toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalledOnce();
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { clerkId: 'user_abc' } }),
    );
  });

  it('gives an invitee their own workspace and leaves the invitation pending', async () => {
    const invitee = {
      id: 3,
      email: 'person@gmail.com',
      name: 'Person',
      organizationId: null,
      role: 'member',
      userStatus: 'pending',
      password: '!invited_placeholder',
      clerkId: null,
      agentKey: '',
      isActive: true,
      avatarUrl: '',
    };
    const { tx, service } = setup({ byEmail: invitee, seats: [] });
    await service.clerkLogin({ token: 'verified' });
    expect(tx.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 3, status: 'active' } }),
    );
    expect(tx.user.update).toHaveBeenLastCalledWith({
      where: { id: 3 },
      data: {
        userStatus: 'active',
        organizationId: 77,
        role: 'ceo',
        memberships: { create: { organizationId: 77, role: 'ceo' } },
      },
    });
  });

  it('moves a person off a workspace they no longer have a seat in', async () => {
    const linked = {
      id: 3,
      email: 'person@gmail.com',
      name: 'Person',
      organizationId: 5,
      role: 'admin',
      userStatus: 'active',
      password: '!invited_placeholder',
      clerkId: 'user_abc',
      agentKey: '',
      isActive: true,
    };
    const { tx, service } = setup({ linked, seats: [{ organizationId: 8, role: 'member' }] });
    await service.clerkLogin({ token: 'verified' });
    expect(tx.organization.create).not.toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { organizationId: 8, role: 'member' },
    });
  });

  it('revokes a password set before the Clerk identity was linked', async () => {
    const account = {
      id: 3,
      email: 'person@gmail.com',
      name: 'Person',
      organizationId: 5,
      role: 'member',
      userStatus: 'active',
      password: 'pbkdf2_sha256$1000$salt$hash',
      clerkId: null,
      agentKey: '',
      isActive: true,
      avatarUrl: '',
    };
    const { tx, service, store } = setup({ byEmail: account, seats: [{ organizationId: 5, role: 'member' }] });
    await service.clerkLogin({ token: 'verified' });

    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clerkId: 'user_abc',
          password: expect.stringMatching(/^!sso_clerk_/),
        }),
      }),
    );
    expect(store.endAllSessions).toHaveBeenCalledWith(3);
  });

  it('refuses AI agent seats and reserved agent addresses', async () => {
    const agent = { id: 3, email: 'person@gmail.com', isActive: true, agentKey: 'qa' };
    await expect(setup({ linked: agent }).service.clerkLogin({ token: 'verified' })).rejects.toThrow(
      'AI agent seats cannot sign in',
    );

    vi.stubEnv('AGENT_EMAIL_DOMAIN', 'gmail.com');
    const { tx, service } = setup();
    (service as any).clerkService.verifyClerkSession.mockResolvedValue({
      clerk_id: 'user_abc',
      email: 'qa+organization-1@gmail.com',
      name: 'Squatter',
    });
    await expect(service.clerkLogin({ token: 'verified' })).rejects.toThrow('reserved');
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('refuses an account already linked to another Clerk identity', async () => {
    const { service } = setup({
      byEmail: { id: 3, email: 'person@gmail.com', organizationId: 5, clerkId: 'user_other', isActive: true },
    });
    await expect(service.clerkLogin({ token: 'verified' })).rejects.toThrow('different Clerk identity');
  });

  it('refuses disabled accounts', async () => {
    const { tx, service } = setup({ linked: { id: 3, email: 'person@gmail.com', isActive: false, agentKey: '' } });
    await expect(service.clerkLogin({ token: 'verified' })).rejects.toThrow('disabled');
    expect(tx.membership.findMany).not.toHaveBeenCalled();
  });
});

describe('active workspace resolution', () => {
  function strategyFor(user: any) {
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue(user) } };
    const store = { status: vi.fn().mockResolvedValue('active') };
    return new JwtStrategy(prisma as any, store as any);
  }
  const payload = { user_id: 3, token_type: 'access', sid: 'session' };
  const person = { id: 3, isActive: true, agentKey: '', organizationId: 5, role: 'ceo' };

  it('takes the role from the seat in the active workspace', async () => {
    const principal: any = await strategyFor({
      ...person,
      memberships: [{ organizationId: 5, role: 'member' }],
    }).validate(payload);
    expect(principal).toMatchObject({ organizationId: 5, role: 'member', sessionJti: 'session' });
  });

  it('fails closed when the active workspace has no seat', async () => {
    const principal: any = await strategyFor({
      ...person,
      memberships: [{ organizationId: 8, role: 'ceo' }],
    }).validate(payload);
    expect(principal).toMatchObject({ organizationId: null, role: 'member' });
  });

  it('never accepts sessions for AI agent seats', async () => {
    await expect(
      strategyFor({ ...person, agentKey: 'pm', memberships: [] }).validate(payload),
    ).rejects.toThrow('inactive');
  });
});

describe('Keycloak sign-in provisioning', () => {
  function setup(claims: Record<string, unknown>, existingOrg: any = null) {
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({ data }: any) => ({ id: 12, isActive: true, ...data })),
      },
      organization: {
        findFirst: vi.fn().mockResolvedValue(existingOrg),
        create: vi.fn(async ({ data }: any) => ({ id: 88, ...data })),
      },
    };
    const prisma = { $transaction: vi.fn((fn: any) => fn(tx)) };
    const keycloak = {
      verifyKeycloakToken: vi.fn().mockResolvedValue({ email: 'kc@acme.test', name: 'Kc Person', ...claims }),
      extractRole: vi.fn().mockReturnValue('backend'),
    };
    const service = new AuthService(prisma as any, new JwtService(), keycloak as any, undefined, memoryStore() as any);
    vi.spyOn(service, 'serializeUser').mockResolvedValue(null);
    return { tx, service };
  }

  it('maps provider roles onto workspace roles in a named workspace', async () => {
    const { tx, service } = setup({ organization: 'Acme' }, { id: 5, name: 'Acme' });
    await service.keycloakLogin({ token: 'verified' });
    expect(tx.organization.create).not.toHaveBeenCalled();
    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role: 'member',
        organizationId: 5,
        memberships: { create: { organizationId: 5, role: 'member' } },
      }),
    });
  });

  it('makes new people the CEO of their own workspace without a claim', async () => {
    const { tx, service } = setup({});
    await service.keycloakLogin({ token: 'verified' });
    expect(tx.organization.findFirst).not.toHaveBeenCalled();
    expect(tx.organization.create).toHaveBeenCalledWith({ data: { name: "Kc Person's workspace" } });
    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ role: 'ceo', organizationId: 88 }),
    });
  });
});
