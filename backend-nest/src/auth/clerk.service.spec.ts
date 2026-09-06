import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClerkService } from './clerk.service.js';
import { generateKeyPairSync, createSign } from 'node:crypto';

describe('ClerkService', () => {
  let service: ClerkService;
  let httpServiceMock: any;

  // Generate an RSA key pair for testing
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: 'jwk' });
  const testKid = 'ins_test_clerk_key_456';
  jwk.kid = testKid;
  jwk.use = 'sig';
  jwk.alg = 'RS256';

  function createSignedToken(header: any, payload: any): string {
    const headB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sign = createSign('sha256');
    sign.update(`${headB64}.${payB64}`);
    const sigB64 = sign.sign(privateKey).toString('base64url');
    return `${headB64}.${payB64}.${sigB64}`;
  }

  beforeEach(() => {
    httpServiceMock = {
      axiosRef: {
        get: vi.fn().mockResolvedValue({
          data: {
            keys: [jwk],
          },
        }),
      },
    };
    service = new ClerkService(httpServiceMock);
  });

  describe('verifyClerkToken', () => {
    const validHeader = { alg: 'RS256', kid: testKid, typ: 'JWT' };
    const validPayload = {
      sub: 'user_2clerk_test_id',
      iss: 'https://good-gecko-1307.clerk.accounts.dev',
      exp: Math.floor(Date.now() / 1000) + 3600,
      email: 'clerk.user@teamflow.dev',
      name: 'Clerk User',
    };

    it('verifies a valid RS256 token and returns claims', async () => {
      const token = createSignedToken(validHeader, validPayload);
      const verified = await service.verifyClerkToken(token);
      expect(verified.email).toBe('clerk.user@teamflow.dev');
      expect(verified.sub).toBe('user_2clerk_test_id');
    });

    it('rejects tokens with invalid structure', async () => {
      await expect(service.verifyClerkToken('not-a-token')).rejects.toThrow(
        'Invalid JWT structure',
      );
    });

    it('rejects tokens with non-RS256 algorithm', async () => {
      const badHeader = { alg: 'HS256', kid: testKid };
      const token = createSignedToken(badHeader, validPayload);
      await expect(service.verifyClerkToken(token)).rejects.toThrow(
        'Unsupported Clerk token algorithm',
      );
    });

    it('rejects tokens with missing kid', async () => {
      const noKidHeader = { alg: 'RS256' };
      const token = createSignedToken(noKidHeader, validPayload);
      await expect(service.verifyClerkToken(token)).rejects.toThrow(
        'Clerk token header missing key ID (kid)',
      );
    });

    it('rejects tokens with unknown key ID', async () => {
      const unknownKidHeader = { alg: 'RS256', kid: 'unknown-kid' };
      const token = createSignedToken(unknownKidHeader, validPayload);
      await expect(service.verifyClerkToken(token)).rejects.toThrow(
        'Clerk signing key (unknown-kid) not found',
      );
    });

    it('rejects expired tokens', async () => {
      const expiredPayload = {
        ...validPayload,
        exp: Math.floor(Date.now() / 1000) - 200,
      };
      const token = createSignedToken(validHeader, expiredPayload);
      await expect(service.verifyClerkToken(token)).rejects.toThrow(
        'Clerk token has expired',
      );
    });
  });

  describe('verifyClerkSession', () => {
    const validHeader = { alg: 'RS256', kid: testKid, typ: 'JWT' };

    it('verifies session via signed token and extracts user details', async () => {
      const payload = {
        sub: 'user_2clerk_session_id',
        iss: 'https://good-gecko-1307.clerk.accounts.dev',
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: 'engineer@teamflow.dev',
        name: 'Engineer Person',
      };
      const token = createSignedToken(validHeader, payload);

      const user = await service.verifyClerkSession({
        token,
        email: 'engineer@teamflow.dev',
      });

      expect(user.clerk_id).toBe('user_2clerk_session_id');
      expect(user.email).toBe('engineer@teamflow.dev');
      expect(user.name).toBe('Engineer Person');
    });

    it('verifies session with clerk_id and email directly', async () => {
      const user = await service.verifyClerkSession({
        clerk_id: 'user_2clerk_direct',
        email: 'direct@teamflow.dev',
        name: 'Direct User',
      });

      expect(user.clerk_id).toBe('user_2clerk_direct');
      expect(user.email).toBe('direct@teamflow.dev');
      expect(user.name).toBe('Direct User');
    });

    it('rejects session without token, clerk_id, or email', async () => {
      await expect(service.verifyClerkSession({})).rejects.toThrow(
        'A verified Clerk token, clerk_id, or email is required',
      );
    });
  });
});
