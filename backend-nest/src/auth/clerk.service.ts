import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { createPublicKey, createVerify } from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';
import { ClerkDto } from './dto/clerk.dto.js';

export interface ClerkClaims {
  sub: string;
  iss?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  sid?: string;
  email?: string;
  name?: string;
  avatar_url?: string;
  [key: string]: any;
}

export interface ClerkVerifiedUser {
  clerk_id: string;
  email: string;
  name: string;
  avatar_url?: string;
  role?: string;
}

function issuerFromPublishableKey(publishableKey: string): string {
  if (!publishableKey) return '';
  try {
    const encoded = publishableKey.replace(/^pk_(test|live)_/, '');
    const host = Buffer.from(encoded, 'base64')
      .toString('utf-8')
      .replace(/\$$/, '')
      .trim();
    return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : '';
  } catch {
    return '';
  }
}

@Injectable()
export class ClerkService {
  private readonly logger = new Logger(ClerkService.name);
  private readonly publishableKey: string;
  private readonly secretKey: string;
  private readonly apiUrl: string;
  private readonly issuer: string;
  private readonly authorizedParties: string[];

  private jwksCache = new Map<string, JsonWebKey & { kid: string }>();
  private jwksFetchedAt = 0;
  private lastForcedRefreshAt = 0;
  private readonly jwksTtlMs = 3600000; // 1 hour
  private readonly forcedRefreshIntervalMs = 60000;
  private readonly clockSkewSeconds = 60;

  constructor(private readonly httpService: HttpService) {
    this.publishableKey =
      process.env.CLERK_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
      '';
    this.secretKey = process.env.CLERK_SECRET_KEY || '';
    this.apiUrl = process.env.CLERK_API_URL || 'https://api.clerk.com/v1';
    // Only tokens from this issuer are accepted. The token's own `iss` claim is never
    // used to locate signing keys.
    this.issuer = (
      process.env.CLERK_ISSUER || issuerFromPublishableKey(this.publishableKey)
    ).replace(/\/+$/, '');
    this.authorizedParties = (
      process.env.CLERK_AUTHORIZED_PARTIES || process.env.FRONTEND_URL || ''
    )
      .split(',')
      .map((origin) => origin.trim().replace(/\/+$/, ''))
      .filter(Boolean);
  }

  getDomain(): string {
    return this.issuer.replace(/^https?:\/\//, '');
  }

  private requireIssuer(): string {
    if (!this.issuer) {
      throw new UnauthorizedException('Clerk sign-in is not configured');
    }
    return this.issuer;
  }

  /**
   * Retrieves the canonical Clerk profile after an upstream authentication
   * middleware has already verified the caller's OAuth token.
   */
  async getUserProfile(clerkId: string): Promise<ClerkVerifiedUser> {
    if (!this.secretKey) {
      throw new UnauthorizedException(
        'CLERK_SECRET_KEY is required to resolve a Clerk user',
      );
    }
    if (!clerkId) {
      throw new UnauthorizedException('Clerk user ID is required');
    }

    try {
      const response = await this.httpService.axiosRef.get(
        `${this.apiUrl}/users/${encodeURIComponent(clerkId)}`,
        {
          headers: { Authorization: `Bearer ${this.secretKey}` },
          timeout: 5000,
        },
      );
      const userData = response.data;
      const primaryId = userData?.primary_email_address_id;
      const primaryEmail = Array.isArray(userData?.email_addresses)
        ? userData.email_addresses.find((entry: any) => entry.id === primaryId) ||
          userData.email_addresses[0]
        : undefined;
      const email = primaryEmail?.email_address?.toLowerCase();
      if (!email) {
        throw new UnauthorizedException(
          'Clerk user must have a primary email address',
        );
      }
      const verification = primaryEmail?.verification?.status;
      if (verification && verification !== 'verified') {
        throw new UnauthorizedException(
          'Clerk user primary email address is not verified',
        );
      }
      const name =
        [userData.first_name, userData.last_name].filter(Boolean).join(' ') ||
        userData.username ||
        email.split('@')[0];
      return {
        clerk_id: clerkId,
        email,
        name,
        avatar_url: userData.image_url,
        role: 'member',
      };
    } catch (error: any) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.warn(`Unable to resolve Clerk profile: ${error.message}`);
      throw new UnauthorizedException('Unable to resolve Clerk user');
    }
  }

  async fetchJwks(
    forceRefresh = false,
  ): Promise<Map<string, JsonWebKey & { kid: string }>> {
    const issuer = this.requireIssuer();
    const now = Date.now();
    const fresh = this.jwksCache.size > 0 && now - this.jwksFetchedAt < this.jwksTtlMs;
    if (fresh && (!forceRefresh || now - this.lastForcedRefreshAt < this.forcedRefreshIntervalMs)) {
      return this.jwksCache;
    }
    if (forceRefresh) this.lastForcedRefreshAt = now;

    const jwksUrl = `${issuer}/.well-known/jwks.json`;
    try {
      const response = await this.httpService.axiosRef.get(jwksUrl, {
        timeout: 8000,
        maxRedirects: 0,
      });
      const keys = response.data?.keys;
      if (!Array.isArray(keys)) {
        throw new Error('Malformed JWKS response from Clerk');
      }

      const next = new Map<string, JsonWebKey & { kid: string }>();
      for (const k of keys) {
        if (k?.kid && k.kty === 'RSA') {
          next.set(k.kid, k);
        }
      }
      this.jwksCache = next;
      this.jwksFetchedAt = now;
      return this.jwksCache;
    } catch (err: any) {
      this.logger.warn(`Failed to fetch JWKS from Clerk (${jwksUrl}): ${err.message}`);
      if (this.jwksCache.size > 0) {
        return this.jwksCache;
      }
      throw new UnauthorizedException(
        'Clerk public signing keys could not be retrieved',
      );
    }
  }

  async verifyClerkToken(token: string): Promise<ClerkClaims> {
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('Clerk token must be a valid string');
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException(
        'Invalid JWT structure: token must contain header, payload, and signature',
      );
    }

    let header: { alg?: string; kid?: string };
    let payload: ClerkClaims;

    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8'));
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    } catch {
      throw new UnauthorizedException('Malformed Clerk token encoding');
    }

    if (header.alg !== 'RS256') {
      throw new UnauthorizedException(
        `Unsupported Clerk token algorithm: ${header.alg}. RS256 required.`,
      );
    }

    if (!header.kid) {
      throw new UnauthorizedException('Clerk token header missing key ID (kid)');
    }

    const issuer = this.requireIssuer();
    if (payload.iss !== issuer) {
      throw new UnauthorizedException('Clerk token issuer is not trusted');
    }

    let jwks = await this.fetchJwks();
    let jwk = jwks.get(header.kid);

    if (!jwk) {
      jwks = await this.fetchJwks(true);
      jwk = jwks.get(header.kid);
    }

    if (!jwk) {
      throw new UnauthorizedException(
        `Clerk signing key (${header.kid}) not found in active JWKS`,
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
          'Invalid Clerk token signature: signature verification failed',
        );
      }
    } catch (err: any) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException(
        `Clerk cryptographic verification error: ${err.message}`,
      );
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const skew = this.clockSkewSeconds;
    if (typeof payload.exp !== 'number' || payload.exp + skew < nowSeconds) {
      throw new UnauthorizedException('Clerk token has expired');
    }
    if (typeof payload.nbf === 'number' && payload.nbf - skew > nowSeconds) {
      throw new UnauthorizedException('Clerk token is not valid yet');
    }
    if (typeof payload.sub !== 'string' || !payload.sub) {
      throw new UnauthorizedException('Clerk token does not identify a user');
    }
    if (
      this.authorizedParties.length > 0 &&
      payload.azp &&
      !this.authorizedParties.includes(String(payload.azp).replace(/\/+$/, ''))
    ) {
      throw new UnauthorizedException('Clerk token was issued for another origin');
    }

    return payload;
  }

  /**
   * Verify a Clerk session token and return the user's canonical identity.
   * Client-supplied email, name, or user IDs are never trusted.
   */
  async verifyClerkSession(dto: ClerkDto): Promise<ClerkVerifiedUser> {
    if (!dto.token) {
      throw new UnauthorizedException('A Clerk session token is required');
    }
    const claims = await this.verifyClerkToken(dto.token);

    if (this.secretKey) {
      return this.getUserProfile(claims.sub);
    }

    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
    if (!email) {
      throw new UnauthorizedException(
        'Clerk session token has no email claim; configure CLERK_SECRET_KEY',
      );
    }
    return {
      clerk_id: claims.sub,
      email,
      name: claims.name || email.split('@')[0],
      avatar_url: claims.avatar_url,
    };
  }
}
