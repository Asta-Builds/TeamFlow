import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { createPublicKey, createVerify } from 'node:crypto';

export interface KeycloakClaims {
  sub: string;
  iss: string;
  aud?: string | string[];
  azp?: string;
  exp: number;
  iat?: number;
  email?: string;
  preferred_username?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
  organization?: string;
  org?: string;
  tenant?: string;
  workspace?: string;
  [key: string]: any;
}

const SUPPORTED_ROLES = new Set([
  'ceo',
  'pm',
  'tech_lead',
  'backend',
  'frontend',
  'devops',
  'qa',
  'designer',
  'seo',
  'admin',
  'member',
]);

@Injectable()
export class KeycloakService {
  private readonly logger = new Logger(KeycloakService.name);

  private readonly keycloakUrl: string;
  private readonly issuerUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;

  private jwksCache = new Map<string, any>();
  private jwksFetchedAt = 0;
  private readonly jwksTtlMs = 3600_000; // 1 hour

  constructor(private readonly httpService: HttpService) {
    this.keycloakUrl = (
      process.env.KEYCLOAK_URL || 'http://keycloak:8080/realms/teamflow'
    ).replace(/\/+$/, '');
    this.issuerUrl = (
      process.env.KEYCLOAK_ISSUER_URL || 'http://localhost:8080/realms/teamflow'
    ).replace(/\/+$/, '');
    this.clientId = process.env.KEYCLOAK_CLIENT_ID || 'teamflow-app';
    this.clientSecret = process.env.KEYCLOAK_CLIENT_SECRET || '';
  }

  async exchangeCodeForToken(
    code: string,
    redirectUri: string,
  ): Promise<string> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.clientId,
      code,
      redirect_uri: redirectUri,
    });
    if (this.clientSecret) {
      params.append('client_secret', this.clientSecret);
    }

    try {
      const response = await this.httpService.axiosRef.post(
        `${this.keycloakUrl}/protocol/openid-connect/token`,
        params.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 10000,
        },
      );

      const token =
        response.data?.access_token ||
        response.data?.id_token;
      if (!token) {
        throw new UnauthorizedException(
          'Keycloak token endpoint did not return an access or ID token',
        );
      }
      return token;
    } catch (err: any) {
      this.logger.warn(
        `Keycloak code exchange failed: ${err.response?.data?.error_description || err.message}`,
      );
      throw new UnauthorizedException(
        'Keycloak authorization-code exchange failed',
      );
    }
  }

  async fetchJwks(forceRefresh = false): Promise<Map<string, any>> {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.jwksCache.size > 0 &&
      now - this.jwksFetchedAt < this.jwksTtlMs
    ) {
      return this.jwksCache;
    }

    try {
      const response = await this.httpService.axiosRef.get(
        `${this.keycloakUrl}/protocol/openid-connect/certs`,
        { timeout: 8000 },
      );
      const keys = response.data?.keys;
      if (!Array.isArray(keys)) {
        throw new Error('Malformed JWKS response from Keycloak');
      }

      this.jwksCache.clear();
      for (const k of keys) {
        if (k.kid) {
          this.jwksCache.set(k.kid, k);
        }
      }
      this.jwksFetchedAt = now;
      return this.jwksCache;
    } catch (err: any) {
      this.logger.error(`Failed to fetch JWKS from Keycloak: ${err.message}`);
      if (this.jwksCache.size > 0) {
        return this.jwksCache; // fallback to existing cache
      }
      throw new UnauthorizedException(
        'Keycloak public signing keys could not be retrieved',
      );
    }
  }

  async verifyKeycloakToken(token: string): Promise<KeycloakClaims> {
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('Keycloak token must be a valid string');
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException(
        'Invalid JWT structure: token must contain header, payload, and signature',
      );
    }

    let header: { alg?: string; kid?: string };
    let payload: KeycloakClaims;

    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8'));
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    } catch {
      throw new UnauthorizedException('Malformed Keycloak token encoding');
    }

    if (header.alg !== 'RS256') {
      throw new UnauthorizedException(
        `Unsupported Keycloak token algorithm: ${header.alg}. RS256 required.`,
      );
    }

    if (!header.kid) {
      throw new UnauthorizedException('Keycloak token header missing key ID (kid)');
    }

    let jwks = await this.fetchJwks();
    let jwk = jwks.get(header.kid);

    // If key not in cache, refresh once
    if (!jwk) {
      jwks = await this.fetchJwks(true);
      jwk = jwks.get(header.kid);
    }

    if (!jwk) {
      throw new UnauthorizedException(
        `Keycloak signing key (${header.kid}) not found in active JWKS`,
      );
    }

    try {
      const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
      const verifier = createVerify('sha256');
      verifier.update(`${parts[0]}.${parts[1]}`);
      const valid = verifier.verify(
        publicKey,
        Buffer.from(parts[2], 'base64url'),
      );
      if (!valid) {
        throw new UnauthorizedException(
          'Invalid Keycloak token signature: signature verification failed',
        );
      }
    } catch (err: any) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException(
        `Keycloak cryptographic verification error: ${err.message}`,
      );
    }

    // Validate claims
    const nowSeconds = Math.floor(Date.now() / 1000);
    const clockTolerance = 60; // 60 seconds tolerance

    if (!payload.exp || payload.exp + clockTolerance < nowSeconds) {
      throw new UnauthorizedException('Keycloak token has expired');
    }

    // Issuer validation (accept both internal Docker network issuer and host/browser issuer)
    const allowedIssuers = new Set([
      this.issuerUrl,
      this.keycloakUrl,
      this.issuerUrl.replace('localhost', '127.0.0.1'),
      this.keycloakUrl.replace('keycloak', 'localhost'),
    ]);

    const tokenIssuer = (payload.iss || '').replace(/\/+$/, '');
    if (!allowedIssuers.has(tokenIssuer)) {
      throw new UnauthorizedException(
        `Invalid Keycloak token issuer: ${payload.iss}`,
      );
    }

    // Audience / Authorized Party validation
    const audMatches = Array.isArray(payload.aud)
      ? payload.aud.includes(this.clientId)
      : payload.aud === this.clientId;
    const azpMatches = payload.azp === this.clientId;

    if (!audMatches && !azpMatches && payload.aud !== 'account') {
      throw new UnauthorizedException(
        `Invalid Keycloak token audience or authorized party`,
      );
    }

    const email = payload.email || payload.preferred_username;
    if (!email || !email.includes('@')) {
      throw new UnauthorizedException(
        'Verified Keycloak token does not contain a valid email address',
      );
    }

    return payload;
  }

  extractRole(claims: KeycloakClaims): string | null {
    const realmRoles = claims.realm_access?.roles || [];
    const clientRoles =
      claims.resource_access?.[this.clientId]?.roles || [];

    const candidates = [...realmRoles, ...clientRoles];
    for (const role of candidates) {
      if (SUPPORTED_ROLES.has(role)) {
        return role;
      }
    }
    return null;
  }
}
