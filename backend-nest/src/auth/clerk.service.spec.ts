import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ClerkService } from './clerk.service.js';
import { generateKeyPairSync, createSign } from 'node:crypto';

const ISSUER = 'https://clerk.example.test';

describe('ClerkService', () => {
  let service: ClerkService;
  let httpServiceMock: any;

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk: any = publicKey.export({ format: 'jwk' });
  const testKid = 'ins_test_clerk_key_456';
  jwk.kid = testKid;
  jwk.use = 'sig';
  jwk.alg = 'RS256';

  function sign(header: any, payload: any, key = privateKey): string {
    const headB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signer = createSign('sha256');
    signer.update(`${headB64}.${payB64}`);
    return `${headB64}.${payB64}.${signer.sign(key).toString('base64url')}`;
  }

  const header = { alg: 'RS256', kid: testKid, typ: 'JWT' };
  const now = () => Math.floor(Date.now() / 1000);
  const claims = (extra: Record<string, unknown> = {}) => ({
    sub: 'user_2clerk_test_id',
    iss: ISSUER,
    exp: now() + 3600,
    email: 'token.claim@teamflow.dev',
    name: 'Clerk User',
    ...extra,
  });

  function profile(email: string, status = 'verified') {
    return {
      data: {
        primary_email_address_id: 'idn_1',
        email_addresses: [{ id: 'idn_1', email_address: email, verification: { status } }],
        first_name: 'Api',
        last_name: 'Profile',
        image_url: 'https://img.clerk.com/avatar.png',
      },
    };
  }

  function build() {
    httpServiceMock = {
      axiosRef: {
        get: vi.fn(async (url: string) => {
          if (url === `${ISSUER}/.well-known/jwks.json`) return { data: { keys: [jwk] } };
          if (url.includes('/users/')) return profile('api.profile@teamflow.dev');
          throw new Error(`unexpected URL ${url}`);
        }),
      },
    };
    service = new ClerkService(httpServiceMock);
  }

  beforeEach(() => {
    vi.stubEnv('CLERK_ISSUER', ISSUER);
    vi.stubEnv('CLERK_SECRET_KEY', '');
    vi.stubEnv('CLERK_PUBLISHABLE_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', '');
    vi.stubEnv('CLERK_AUTHORIZED_PARTIES', '');
    vi.stubEnv('FRONTEND_URL', '');
    build();
  });
  afterEach(() => vi.unstubAllEnvs());

  describe('verifyClerkToken', () => {
    it('verifies a valid RS256 token using keys from the configured issuer', async () => {
      const verified = await service.verifyClerkToken(sign(header, claims()));
      expect(verified.sub).toBe('user_2clerk_test_id');
      expect(httpServiceMock.axiosRef.get).toHaveBeenCalledWith(
        `${ISSUER}/.well-known/jwks.json`,
        expect.anything(),
      );
    });

    it('never fetches keys from the token issuer claim', async () => {
      const forged = sign(header, claims({ iss: 'https://evil.example' }), attacker.privateKey);
      await expect(service.verifyClerkToken(forged)).rejects.toThrow('issuer is not trusted');
      for (const call of httpServiceMock.axiosRef.get.mock.calls) {
        expect(call[0]).not.toContain('evil.example');
      }
    });

    it('rejects tokens signed by another key', async () => {
      const forged = sign(header, claims(), attacker.privateKey);
      await expect(service.verifyClerkToken(forged)).rejects.toThrow('signature');
    });

    it('fails closed when no Clerk issuer is configured', async () => {
      vi.stubEnv('CLERK_ISSUER', '');
      build();
      await expect(service.verifyClerkToken(sign(header, claims()))).rejects.toThrow(
        'not configured',
      );
    });

    it('derives the issuer from the publishable key', async () => {
      vi.stubEnv('CLERK_ISSUER', '');
      vi.stubEnv(
        'CLERK_PUBLISHABLE_KEY',
        `pk_test_${Buffer.from('clerk.example.test$').toString('base64')}`,
      );
      build();
      await expect(service.verifyClerkToken(sign(header, claims()))).resolves.toMatchObject({
        sub: 'user_2clerk_test_id',
      });
    });

    it('rejects malformed, unsupported, and keyless tokens', async () => {
      await expect(service.verifyClerkToken('not-a-token')).rejects.toThrow('Invalid JWT structure');
      await expect(
        service.verifyClerkToken(sign({ alg: 'HS256', kid: testKid }, claims())),
      ).rejects.toThrow('Unsupported Clerk token algorithm');
      await expect(service.verifyClerkToken(sign({ alg: 'RS256' }, claims()))).rejects.toThrow(
        'missing key ID',
      );
      await expect(
        service.verifyClerkToken(sign({ alg: 'RS256', kid: 'unknown-kid' }, claims())),
      ).rejects.toThrow('Clerk signing key (unknown-kid) not found');
    });

    it('enforces exp, nbf, and sub', async () => {
      await expect(
        service.verifyClerkToken(sign(header, claims({ exp: now() - 200 }))),
      ).rejects.toThrow('expired');
      await expect(
        service.verifyClerkToken(sign(header, claims({ exp: undefined }))),
      ).rejects.toThrow('expired');
      await expect(
        service.verifyClerkToken(sign(header, claims({ nbf: now() + 600 }))),
      ).rejects.toThrow('not valid yet');
      await expect(
        service.verifyClerkToken(sign(header, claims({ sub: '' }))),
      ).rejects.toThrow('does not identify');
    });

    it('checks the authorized party when origins are configured', async () => {
      vi.stubEnv('CLERK_AUTHORIZED_PARTIES', 'https://app.example.test');
      build();
      await expect(
        service.verifyClerkToken(sign(header, claims({ azp: 'https://evil.example' }))),
      ).rejects.toThrow('another origin');
      await expect(
        service.verifyClerkToken(sign(header, claims({ azp: 'https://app.example.test/' }))),
      ).resolves.toBeTruthy();
    });
  });

  describe('verifyClerkSession', () => {
    it('requires a signed session token even when an email or user ID is supplied', async () => {
      await expect(
        service.verifyClerkSession({ clerk_id: 'user_victim', email: 'ceo@victim.example' }),
      ).rejects.toThrow('session token is required');
      await expect(service.verifyClerkSession({})).rejects.toThrow('session token is required');
      expect(httpServiceMock.axiosRef.get).not.toHaveBeenCalled();
    });

    it('ignores client-supplied identity fields', async () => {
      const user = await service.verifyClerkSession({
        token: sign(header, claims()),
        email: 'ceo@victim.example',
        clerk_id: 'user_victim',
        name: 'Spoofed',
      });
      expect(user).toMatchObject({
        clerk_id: 'user_2clerk_test_id',
        email: 'token.claim@teamflow.dev',
        name: 'Clerk User',
      });
    });

    it('uses the Clerk Backend API profile when a secret key is configured', async () => {
      vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_secret');
      build();
      const user = await service.verifyClerkSession({ token: sign(header, claims()) });
      expect(user.email).toBe('api.profile@teamflow.dev');
      expect(user.name).toBe('Api Profile');
      expect(httpServiceMock.axiosRef.get).toHaveBeenCalledWith(
        'https://api.clerk.com/v1/users/user_2clerk_test_id',
        expect.anything(),
      );
    });

    it('rejects an unverified primary email', async () => {
      vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_secret');
      build();
      httpServiceMock.axiosRef.get.mockImplementation(async (url: string) =>
        url.includes('/users/')
          ? profile('pending@teamflow.dev', 'unverified')
          : { data: { keys: [jwk] } },
      );
      await expect(
        service.verifyClerkSession({ token: sign(header, claims()) }),
      ).rejects.toThrow('not verified');
    });

    it('requires an email claim when no secret key is configured', async () => {
      await expect(
        service.verifyClerkSession({ token: sign(header, claims({ email: undefined })) }),
      ).rejects.toThrow('no email claim');
    });
  });
});
