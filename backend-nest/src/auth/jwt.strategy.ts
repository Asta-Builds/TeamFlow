import { requireSecret } from './security.js';
import { Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import { RefreshTokenStore } from './refresh-token.store.js';
import { ACTIVE_SEATS, withActiveSeat } from '../common/workspace.js';

export interface JwtPayload {
  token_type?: string;
  user_id?: number;
  sub?: number;
  sid?: string;
  email?: string;
  role?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly tokenStore: RefreshTokenStore;

  constructor(
    private prisma: PrismaService,
    @Optional() tokenStore?: RefreshTokenStore,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['HS256'],
      secretOrKey: requireSecret('JWT_SECRET'),
    });
    this.tokenStore = tokenStore ?? new RefreshTokenStore(prisma);
  }

  async validate(payload: JwtPayload) {
    const userId = payload.user_id ?? payload.sub;
    if (
      !Number.isSafeInteger(userId) ||
      !userId ||
      payload.token_type !== 'access' ||
      !payload.sid
    ) {
      throw new UnauthorizedException('Invalid token payload');
    }
    if ((await this.tokenStore.status(payload.sid)) !== 'active') {
      throw new UnauthorizedException('Session has ended');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { organization: true, memberships: ACTIVE_SEATS },
    });

    // AI agent seats never hold sessions.
    if (!user || !user.isActive || user.agentKey) {
      throw new UnauthorizedException('User not found or inactive');
    }

    return Object.assign(withActiveSeat(user), { sessionJti: payload.sid });
  }
}
