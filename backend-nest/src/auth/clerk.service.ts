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

@Injectable()
export class ClerkService {
  private readonly logger = new Logger(ClerkService.name);
  private readonly publishableKey?: string;
  private readonly secretKey?: string;
  private readonly apiUrl: string;
  private defaultDomain?: string;

  private jwksCache = new Map<string, JsonWebKey & { kid: string }>();
  private jwksFetchedAt = 0;
  private readonly jwksTtlMs = 3600000; // 1 hour

  constructor(private readonly httpService: HttpService) {
    this.publishableKey =
      process.env.CLERK_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
      '';
    this.secretKey = process.env.CLERK_SECRET_KEY || '';
    this.apiUrl = process.env.CLERK_API_URL || 'https://api.clerk.com/v1';

    if (this.publishableKey) {
      try {
        const rawKey = this.publishableKey.replace(/^pk_(test|live)_/, '');
        const decoded = Buffer.from(rawKey, 'base64').toString('utf-8');
        this.defaultDomain = decoded.replace(/\$$/, '');
      } catch {
        this.defaultDomain = 'good-gecko-1307.clerk.accounts.dev';
      }
    } else {
      this.defaultDomain = 'good-gecko-1307.clerk.accounts.dev';
    }
  }

  getDomain(): string {
    return this.defaultDomain || 'good-gecko-1307.clerk.accounts.dev';
  }

  async fetchJwks(
    issuerUrl?: string,
    forceRefresh = false,
  ): Promise<Map<string, JsonWebKey & { kid: string }>> {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.jwksCache.size > 0 &&
      now - this.jwksFetchedAt < this.jwksTtlMs
    ) {
      return this.jwksCache;
    }

    const domain = issuerUrl
      ? issuerUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
      : this.getDomain();
    const jwksUrl = `https://${domain}/.well-known/jwks.json`;

    try {
      const response = await this.httpService.axiosRef.get(jwksUrl, {
        timeout: 8000,
      });
      const keys = response.data?.keys;
      if (!Array.isArray(keys)) {
        throw new Error('Malformed JWKS response from Clerk');
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

    let jwks = await this.fetchJwks(payload.iss);
    let jwk = jwks.get(header.kid);

    if (!jwk) {
      jwks = await this.fetchJwks(payload.iss, true);
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

    // Validate expiration
    const nowSeconds = Math.floor(Date.now() / 1000);
    const clockTolerance = 60; // 60s clock skew
    if (payload.exp && payload.exp + clockTolerance < nowSeconds) {
      throw new UnauthorizedException('Clerk token has expired');
    }

    return payload;
  }

  async verifyClerkSession(dto: ClerkDto): Promise<ClerkVerifiedUser> {
    let claims: ClerkClaims | undefined;
    let clerkId = dto.clerk_id;

    if (dto.token) {
      claims = await this.verifyClerkToken(dto.token);
      clerkId = claims.sub || clerkId;
    }

    if (!clerkId && !dto.email) {
      throw new UnauthorizedException(
        'A verified Clerk token, clerk_id, or email is required',
      );
    }

    let email = (claims?.email || dto.email)?.toLowerCase();
    let name = claims?.name || dto.name;
    let avatarUrl = claims?.avatar_url || dto.avatar_url;

    // If secret key is available and we have a clerkId, query Clerk REST API for authoritative profile
    if (this.secretKey && clerkId) {
      try {
        const res = await this.httpService.axiosRef.get(
          `${this.apiUrl}/users/${clerkId}`,
          {
            headers: {
              Authorization: `Bearer ${this.secretKey}`,
            },
            timeout: 5000,
          },
        );
        const userData = res.data;
        if (userData) {
          if (Array.isArray(userData.email_addresses) && userData.email_addresses.length > 0) {
            const primaryId = userData.primary_email_address_id;
            const primaryObj = userData.email_addresses.find(
              (e: any) => e.id === primaryId,
            ) || userData.email_addresses[0];
            if (primaryObj?.email_address) {
              email = primaryObj.email_address.toLowerCase();
            }
          }
          const fullName = [userData.first_name, userData.last_name]
            .filter(Boolean)
            .join(' ');
          if (fullName) {
            name = fullName;
          } else if (userData.username) {
            name = userData.username;
          }
          if (userData.image_url) {
            avatarUrl = userData.image_url;
          }
        }
      } catch (err: any) {
        this.logger.debug(
          `Clerk API lookup for ${clerkId} skipped or failed: ${err.message}`,
        );
      }
    }

    if (!email) {
      throw new UnauthorizedException(
        'Clerk user profile must have a valid email address',
      );
    }

    return {
      clerk_id: clerkId || `clerk_user_${Buffer.from(email).toString('hex').slice(0, 16)}`,
      email,
      name: name || email.split('@')[0],
      avatar_url: avatarUrl,
      role: 'member',
    };
  }
}
