import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export type RefreshTokenStatus = 'active' | 'revoked' | 'unknown';

/**
 * Session registry backed by Django SimpleJWT's blacklist tables
 * (`token_blacklist_outstandingtoken` / `token_blacklist_blacklistedtoken`),
 * which already exist in the shared database.
 *
 * - NestJS rows store only a SHA-256 fingerprint (`sha256:` prefix), never the token.
 * - A rotated refresh token is blacklisted, so presenting it again is detectable reuse.
 * - Logout and password changes delete NestJS rows, so old tokens are simply unknown.
 * - Django's foreign key cascades exist only in the ORM, so blacklist rows are
 *   removed before their outstanding rows.
 */
@Injectable()
export class RefreshTokenStore {
  constructor(private readonly prisma: PrismaService) {}

  async record(jti: string, userId: number, token: string, expiresAt: Date): Promise<void> {
    const fingerprint = `sha256:${createHash('sha256').update(token).digest('hex')}`;
    await this.prisma.$executeRaw`
      INSERT INTO token_blacklist_outstandingtoken (jti, token, user_id, created_at, expires_at)
      VALUES (${jti}, ${fingerprint}, ${userId}, NOW(), ${expiresAt})`;
  }

  async status(jti: string): Promise<RefreshTokenStatus> {
    const rows = await this.prisma.$queryRaw<{ blacklisted: boolean }[]>`
      SELECT (b.id IS NOT NULL) AS blacklisted
      FROM token_blacklist_outstandingtoken o
      LEFT JOIN token_blacklist_blacklistedtoken b ON b.token_id = o.id
      WHERE o.jti = ${jti} AND o.expires_at > NOW()
      LIMIT 1`;
    if (!rows.length) return 'unknown';
    return rows[0].blacklisted ? 'revoked' : 'active';
  }

  /** Mark a refresh token as used. Returns true only for the call that consumed it. */
  async rotate(jti: string): Promise<boolean> {
    const inserted = await this.prisma.$executeRaw`
      INSERT INTO token_blacklist_blacklistedtoken (token_id, blacklisted_at)
      SELECT o.id, NOW() FROM token_blacklist_outstandingtoken o WHERE o.jti = ${jti}
      ON CONFLICT (token_id) DO NOTHING`;
    return inserted > 0;
  }

  /** End one NestJS session (logout). */
  async endSession(jti: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.$executeRaw`
        DELETE FROM token_blacklist_blacklistedtoken
        WHERE token_id IN (
          SELECT id FROM token_blacklist_outstandingtoken
          WHERE jti = ${jti} AND token LIKE 'sha256:%'
        )`,
      this.prisma.$executeRaw`
        DELETE FROM token_blacklist_outstandingtoken
        WHERE jti = ${jti} AND token LIKE 'sha256:%'`,
    ]);
  }

  /**
   * End every session of a user (password change, detected token theft).
   * NestJS sessions are deleted; Django-issued refresh tokens are blacklisted.
   */
  async endAllSessions(userId: number): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.$executeRaw`
        DELETE FROM token_blacklist_blacklistedtoken
        WHERE token_id IN (
          SELECT id FROM token_blacklist_outstandingtoken
          WHERE user_id = ${userId} AND token LIKE 'sha256:%'
        )`,
      this.prisma.$executeRaw`
        DELETE FROM token_blacklist_outstandingtoken
        WHERE user_id = ${userId} AND token LIKE 'sha256:%'`,
      this.prisma.$executeRaw`
        INSERT INTO token_blacklist_blacklistedtoken (token_id, blacklisted_at)
        SELECT o.id, NOW() FROM token_blacklist_outstandingtoken o
        WHERE o.user_id = ${userId} AND o.expires_at > NOW()
        ON CONFLICT (token_id) DO NOTHING`,
    ]);
  }
}
