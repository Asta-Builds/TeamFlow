import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeycloakService } from './keycloak.service.js';
import { generateKeyPairSync, createSign } from 'node:crypto';

describe('KeycloakService', () => {
  let service: KeycloakService;
  let httpServiceMock: any;

  // Generate an RSA key pair for testing
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: 'jwk' });
  const testKid = 'test-key-id-123';
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
        post: vi.fn(),
      },
    };
    service = new KeycloakService(httpServiceMock);
  });

  describe('exchangeCodeForToken', () => {
    it('successfully exchanges authorization code for access token', async () => {
      httpServiceMock.axiosRef.post.mockResolvedValue({
        data: { access_token: 'mock-access-token' },
      });

      const token = await service.exchangeCodeForToken(
        'valid-code',
        'http://localhost:3000/auth/callback',
      );
      expect(token).toBe('mock-access-token');
      expect(httpServiceMock.axiosRef.post).toHaveBeenCalledWith(
        expect.stringContaining('/protocol/openid-connect/token'),
        expect.stringContaining('grant_type=authorization_code'),
        expect.any(Object),
      );
    });

    it('throws UnauthorizedException if Keycloak returns an error', async () => {
      httpServiceMock.axiosRef.post.mockRejectedValue(new Error('Invalid grant'));
      await expect(
        service.exchangeCodeForToken(
          'bad-code',
          'http://localhost:3000/auth/callback',
        ),
      ).rejects.toThrow('Keycloak authorization-code exchange failed');
    });
  });

  describe('verifyKeycloakToken', () => {
    const validHeader = { alg: 'RS256', kid: testKid, typ: 'JWT' };
    const validPayload = {
      sub: 'user-sub-123',
      iss: 'http://localhost:8080/realms/teamflow',
      aud: 'teamflow-app',
      exp: Math.floor(Date.now() / 1000) + 3600,
      email: 'sso.user@teamflow.dev',
      name: 'SSO User',
      realm_access: { roles: ['tech_lead'] },
    };

    it('verifies a valid RS256 token and returns claims', async () => {
      const token = createSignedToken(validHeader, validPayload);
      const verified = await service.verifyKeycloakToken(token);
      expect(verified.email).toBe('sso.user@teamflow.dev');
      expect(verified.sub).toBe('user-sub-123');
    });

    it('rejects tokens with invalid structure', async () => {
      await expect(service.verifyKeycloakToken('invalid.token')).rejects.toThrow(
        'Invalid JWT structure',
      );
    });

    it('rejects tokens with non-RS256 algorithm', async () => {
      const badHeader = { alg: 'HS256', kid: testKid };
      const token = createSignedToken(badHeader, validPayload);
      await expect(service.verifyKeycloakToken(token)).rejects.toThrow(
        'Unsupported Keycloak token algorithm',
      );
    });

    it('rejects tokens with unknown key ID', async () => {
      const unknownKidHeader = { alg: 'RS256', kid: 'non-existent-kid' };
      const token = createSignedToken(unknownKidHeader, validPayload);
      await expect(service.verifyKeycloakToken(token)).rejects.toThrow(
        'Keycloak signing key (non-existent-kid) not found',
      );
    });

    it('rejects expired tokens', async () => {
      const expiredPayload = {
        ...validPayload,
        exp: Math.floor(Date.now() / 1000) - 1000,
      };
      const token = createSignedToken(validHeader, expiredPayload);
      await expect(service.verifyKeycloakToken(token)).rejects.toThrow(
        'Keycloak token has expired',
      );
    });

    it('rejects invalid issuer', async () => {
      const badIssuerPayload = {
        ...validPayload,
        iss: 'http://evil-issuer.com/realms/fake',
      };
      const token = createSignedToken(validHeader, badIssuerPayload);
      await expect(service.verifyKeycloakToken(token)).rejects.toThrow(
        'Invalid Keycloak token issuer',
      );
    });

    it('rejects tokens without an email or username', async () => {
      const noEmailPayload = {
        sub: 'user-123',
        iss: 'http://localhost:8080/realms/teamflow',
        aud: 'teamflow-app',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createSignedToken(validHeader, noEmailPayload);
      await expect(service.verifyKeycloakToken(token)).rejects.toThrow(
        'does not contain a valid email',
      );
    });
  });

  describe('extractRole', () => {
    it('extracts supported role from realm_access.roles', () => {
      const claims = {
        sub: 'u1',
        iss: '',
        exp: 0,
        realm_access: { roles: ['offline_access', 'devops'] },
      };
      expect(service.extractRole(claims)).toBe('devops');
    });

    it('extracts supported role from resource_access[clientId].roles', () => {
      const claims = {
        sub: 'u1',
        iss: '',
        exp: 0,
        resource_access: {
          'teamflow-app': { roles: ['qa'] },
        },
      };
      expect(service.extractRole(claims)).toBe('qa');
    });

    it('returns null if no supported role is matched', () => {
      const claims = {
        sub: 'u1',
        iss: '',
        exp: 0,
        realm_access: { roles: ['default-roles-teamflow', 'custom_unknown'] },
      };
      expect(service.extractRole(claims)).toBeNull();
    });
  });
});
