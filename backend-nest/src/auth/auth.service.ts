import {
  Injectable,
  Optional,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword, requireSecret } from './security.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { KeycloakDto } from './dto/keycloak.dto.js';
import { KeycloakService } from './keycloak.service.js';
import { ClerkDto } from './dto/clerk.dto.js';
import { ClerkService } from './clerk.service.js';
import { RefreshTokenStore } from './refresh-token.store.js';
import { LogoutDto } from './dto/logout.dto.js';
import {
  ensureActiveWorkspace,
  humanRoleFor,
  isReservedAgentEmail,
  hasUsablePassword,
  personalWorkspaceName,
} from '../common/workspace.js';

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface TokenPair {
  access: string;
  refresh: string;
}

@Injectable()
export class AuthService {
  private readonly tokenStore: RefreshTokenStore;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    @Optional() private keycloakService?: KeycloakService,
    @Optional() private clerkService?: ClerkService,
    @Optional() tokenStore?: RefreshTokenStore,
  ) {
    this.tokenStore = tokenStore ?? new RefreshTokenStore(prisma);
  }

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    if (isReservedAgentEmail(email)) {
      throw new BadRequestException('This email address is reserved for AI agent seats');
    }
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await hashPassword(dto.password);
    // Organization and account creation must succeed together. Public signups
    // never join an existing tenant or choose their own role: every new person
    // founds their own workspace as its CEO.
    const user = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: dto.organization_name?.trim() || personalWorkspaceName(dto.name, email),
        },
      });
      return tx.user.create({
        data: {
          email,
          password: hashedPassword,
          name: dto.name || email.split('@')[0],
          role: 'ceo',
          userStatus: 'active',
          organizationId: org.id,
          memberships: { create: { organizationId: org.id, role: 'ceo' } },
        },
      });
    });

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    const serializedUser = await this.serializeUser(user.id);

    return {
      ...tokens,
      user: serializedUser,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: { organization: true },
    });

    // AI agent seats never sign in.
    if (!user || user.agentKey) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (
      !user.isActive ||
      !(await verifyPassword(dto.password, user.password))
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const active = await this.prisma.$transaction((tx) => ensureActiveWorkspace(tx, user));
    const tokens = await this.generateTokens(active.id, active.email, active.role);
    const serializedUser = await this.serializeUser(active.id);

    return {
      ...tokens,
      user: serializedUser,
    };
  }

  /**
   * Rotate a refresh token. Each refresh token works once; presenting a used or
   * revoked token is treated as theft and revokes every session of the user.
   */
  async refresh(dto: RefreshDto): Promise<TokenPair> {
    let payload: any;
    try {
      payload = this.jwtService.verify(dto.refresh, {
        secret: requireSecret('JWT_REFRESH_SECRET'),
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const userId = payload.user_id ?? payload.sub;
    if (payload.token_type !== 'refresh' || !payload.jti || !Number.isSafeInteger(userId)) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const status = await this.tokenStore.status(payload.jti);
    if (status === 'unknown') {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (status === 'revoked' || !(await this.tokenStore.rotate(payload.jti))) {
      await this.tokenStore.endAllSessions(userId);
      throw new UnauthorizedException('Refresh token reuse detected; all sessions were signed out');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive || user.agentKey) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return this.generateTokens(user.id, user.email, user.role);
  }

  /** Revoke the caller's current session and, when supplied, the given refresh token. */
  async logout(user: { id: number; sessionJti?: string }, dto?: LogoutDto) {
    if (user.sessionJti) {
      await this.tokenStore.endSession(user.sessionJti);
    }
    if (dto?.refresh) {
      try {
        const payload: any = this.jwtService.verify(dto.refresh, {
          secret: requireSecret('JWT_REFRESH_SECRET'),
          algorithms: ['HS256'],
          ignoreExpiration: true,
        });
        const owner = payload.user_id ?? payload.sub;
        if (payload.token_type === 'refresh' && payload.jti && owner === user.id) {
          await this.tokenStore.endSession(payload.jti);
        }
      } catch {
        // An invalid refresh token cannot grant access, so there is nothing to revoke.
      }
    }
    return { detail: 'Successfully logged out.' };
  }

  async changePassword(userId: number, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (
      !user.isActive ||
      !(await verifyPassword(dto.old_password, user.password))
    ) {
      throw new BadRequestException('Incorrect old password');
    }

    const newHash = await hashPassword(dto.new_password);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: newHash },
    });

    // Every existing session ends; the caller continues with a fresh session.
    await this.tokenStore.endAllSessions(userId);
    const tokens = await this.generateTokens(user.id, user.email, user.role);
    return { message: 'Password updated successfully', ...tokens };
  }

  async serializeUser(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        organization: true,
        assignedTasks: {
          select: { status: true },
        },
      },
    });

    if (!user) return null;

    const openCount = user.assignedTasks.filter(
      (t) => t.status !== 'done',
    ).length;
    const closedCount = user.assignedTasks.filter(
      (t) => t.status === 'done',
    ).length;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      agent_key: user.agentKey,
      is_ai_agent: Boolean(user.agentKey),
      user_status: user.userStatus,
      avatar_url: user.avatarUrl,
      bio: user.bio,
      is_active: user.isActive,
      date_joined: user.dateJoined.toISOString(),
      organization: user.organizationId,
      organization_name: user.organization?.name,
      organization_tier: user.organization?.subscriptionTier ?? 'starter',
      organization_status: user.organization?.subscriptionStatus ?? 'active',
      open_tasks_count: openCount,
      closed_tasks_count: closedCount,
    };
  }

  /**
   * Issue a new session. The refresh token is registered so it can be rotated
   * and revoked; the access token carries the session id (`sid`) so revoking
   * the session also invalidates its access tokens.
   */
  async generateTokens(userId: number, email: string, role: string): Promise<TokenPair> {
    const payload = { user_id: userId, sub: userId, email, role };
    const sessionJti = randomUUID();
    const access = this.jwtService.sign(
      { ...payload, token_type: 'access', jti: randomUUID(), sid: sessionJti },
      {
        secret: requireSecret('JWT_SECRET'),
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        algorithm: 'HS256',
      },
    );
    const refresh = this.jwtService.sign(
      { ...payload, token_type: 'refresh', jti: sessionJti },
      {
        secret: requireSecret('JWT_REFRESH_SECRET'),
        expiresIn: REFRESH_TOKEN_TTL_SECONDS,
        algorithm: 'HS256',
      },
    );
    await this.tokenStore.record(
      sessionJti,
      userId,
      refresh,
      new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    );

    return { access, refresh };
  }

  async keycloakLogin(dto: KeycloakDto) {
    if (!this.keycloakService) {
      throw new UnauthorizedException('Keycloak service is not configured');
    }

    let token = dto.token || dto.access_token || dto.id_token;

    if (dto.code && !token) {
      if (!dto.redirect_uri) {
        throw new BadRequestException(
          'redirect_uri is required when exchanging a Keycloak authorization code',
        );
      }
      token = await this.keycloakService.exchangeCodeForToken(dto.code, dto.redirect_uri);
    }

    if (!token) {
      throw new UnauthorizedException(
        'A verified Keycloak token or authorization code is required',
      );
    }

    const claims = await this.keycloakService.verifyKeycloakToken(token);
    const email = (claims.email || claims.preferred_username!).toLowerCase();
    const name = claims.name || claims.given_name || email.split('@')[0];
    // Identity-provider roles are mapped onto the roles a person can hold.
    const idpRole = this.keycloakService.extractRole(claims);

    const orgNameClaim =
      claims.organization || claims.org || claims.tenant || claims.workspace;
    // Only an explicit organization claim from the trusted identity provider selects a
    // shared tenant. Without one, a new account gets its own workspace.
    const orgName = typeof orgNameClaim === 'string' ? orgNameClaim.trim() : '';

    const user = await this.prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({ where: { email } });
      if (existingUser && (existingUser.agentKey || !existingUser.isActive)) {
        throw new UnauthorizedException('This account cannot sign in');
      }
      if (!existingUser && isReservedAgentEmail(email)) {
        throw new UnauthorizedException('This email address is reserved for AI agent seats');
      }

      let org = orgName
        ? await tx.organization.findFirst({ where: { name: orgName }, orderBy: { id: 'asc' } })
        : null;
      const createOrg = !org && Boolean(orgName || !existingUser);
      if (createOrg) {
        org = await tx.organization.create({
          data: { name: orgName || personalWorkspaceName(name, email) },
        });
      }
      const role = createOrg ? 'ceo' : humanRoleFor(idpRole);

      if (!existingUser) {
        return tx.user.create({
          data: {
            email,
            password: `!sso_keycloak_${randomUUID()}`,
            name,
            role,
            organizationId: org!.id,
            memberships: { create: { organizationId: org!.id, role } },
          },
        });
      }

      if (org) {
        const setRole = createOrg || idpRole !== null;
        const seat = await tx.membership.upsert({
          where: { userId_organizationId: { userId: existingUser.id, organizationId: org.id } },
          create: { userId: existingUser.id, organizationId: org.id, role },
          update: { status: 'active', ...(setRole && { role }) },
        });
        if (existingUser.organizationId === null) {
          await tx.user.update({
            where: { id: existingUser.id },
            data: { organizationId: org.id, role: seat.role },
          });
          existingUser.organizationId = org.id;
          existingUser.role = seat.role;
        }
      }
      return ensureActiveWorkspace(tx, existingUser);
    });

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    const serializedUser = await this.serializeUser(user.id);

    return {
      ...tokens,
      user: serializedUser,
    };
  }

  async clerkLogin(dto: ClerkDto) {
    if (!this.clerkService) {
      throw new UnauthorizedException('Clerk service is not configured');
    }

    const verified = await this.clerkService.verifyClerkSession(dto);
    const clerkId = verified.clerk_id;
    const email = verified.email.toLowerCase();
    const name = verified.name || email.split('@')[0];
    const avatarUrl = verified.avatar_url || '';

    let revokedUserId: number | undefined;

    const user = await this.prisma.$transaction(async (tx) => {
      const refuse = (account: { isActive: boolean; agentKey: string }) => {
        if (account.agentKey) {
          throw new UnauthorizedException('AI agent seats cannot sign in');
        }
        if (!account.isActive) {
          throw new UnauthorizedException('This account is disabled');
        }
      };

      const linked = await tx.user.findUnique({ where: { clerkId } });
      if (linked) {
        refuse(linked);
        return ensureActiveWorkspace(tx, linked);
      }

      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) {
        refuse(existing);
        // An invited or pre-existing account is linked to its verified Clerk identity.
        if (existing.clerkId && existing.clerkId !== clerkId) {
          throw new UnauthorizedException(
            'This TeamFlow account is linked to a different Clerk identity',
          );
        }
        const revokePassword = !existing.clerkId && hasUsablePassword(existing.password);
        if (revokePassword) {
          revokedUserId = existing.id;
        }

        const linkedUser = await tx.user.update({
          where: { id: existing.id },
          data: {
            clerkId,
            ...(existing.avatarUrl || !avatarUrl ? {} : { avatarUrl }),
            // A placeholder created by an invitation takes the person's own name.
            ...(existing.userStatus === 'pending' && verified.name ? { name: verified.name } : {}),
            ...(revokePassword ? { password: `!sso_clerk_${randomUUID()}` } : {}),
          },
        });
        return ensureActiveWorkspace(tx, linkedUser);
      }

      if (isReservedAgentEmail(email)) {
        throw new UnauthorizedException('This email address is reserved for AI agent seats');
      }
      // New sign-ups always get their own workspace, exactly like /auth/register.
      // Accounts never join an existing tenant based on email domain or name.
      const org = await tx.organization.create({
        data: { name: personalWorkspaceName(name, email) },
      });
      return tx.user.create({
        data: {
          email,
          clerkId,
          password: `!sso_clerk_${randomUUID()}`,
          name,
          role: 'ceo',
          organizationId: org.id,
          avatarUrl,
          memberships: { create: { organizationId: org.id, role: 'ceo' } },
        },
      });
    });

    if (revokedUserId) {
      await this.tokenStore.endAllSessions(revokedUserId);
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    const serializedUser = await this.serializeUser(user.id);

    return {
      ...tokens,
      user: serializedUser,
    };
  }
}
