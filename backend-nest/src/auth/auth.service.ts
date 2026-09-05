import {
  Injectable,
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

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private keycloakService?: KeycloakService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await hashPassword(dto.password);
    // Organization and account creation must succeed together. Public signups
    // never join an existing tenant or choose their own privileged role.
    const user = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name:
            dto.organization_name?.trim() ||
            `${dto.name || dto.email.split('@')[0]}'s workspace`,
        },
      });
      return tx.user.create({
        data: {
          email: dto.email.toLowerCase(),
          password: hashedPassword,
          name: dto.name || dto.email.split('@')[0],
          role: 'ceo',
          organizationId: org.id,
          avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(dto.email)}`,
        },
      });
    });

    const tokens = this.generateTokens(user.id, user.email, user.role);
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

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (
      !user.isActive ||
      !(await verifyPassword(dto.password, user.password))
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = this.generateTokens(user.id, user.email, user.role);
    const serializedUser = await this.serializeUser(user.id);

    return {
      ...tokens,
      user: serializedUser,
    };
  }

  async refresh(dto: RefreshDto) {
    try {
      const payload = this.jwtService.verify(dto.refresh, {
        secret: requireSecret('JWT_REFRESH_SECRET'),
        algorithms: ['HS256'],
      });
      if (payload.token_type !== 'refresh')
        throw new UnauthorizedException('Invalid refresh token');
      const userId = payload.user_id ?? payload.sub;
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user || !user.isActive) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const tokens = this.generateTokens(user.id, user.email, user.role);
      return tokens;
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
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

    return { message: 'Password updated successfully' };
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

  generateTokens(userId: number, email: string, role: string) {
    const payload = { user_id: userId, sub: userId, email, role };
    const access = this.jwtService.sign(
      { ...payload, token_type: 'access', jti: randomUUID() },
      {
        secret: requireSecret('JWT_SECRET'),
        expiresIn: '1d',
      },
    );
    const refresh = this.jwtService.sign(
      { ...payload, token_type: 'refresh', jti: randomUUID() },
      {
        secret: requireSecret('JWT_REFRESH_SECRET'),
        expiresIn: '7d',
      },
    );

    return { access, refresh };
  }

  async keycloakLogin(dto: KeycloakDto) {
    if (!this.keycloakService) {
      throw new UnauthorizedException('Keycloak service is not configured');
    }

    let token = dto.token || dto.access_token || dto.id_token;

    if (dto.code && !token) {
      token = await this.keycloakService.exchangeCodeForToken(
        dto.code,
        dto.redirect_uri || 'http://localhost:3000/auth/callback',
      );
    }

    if (!token) {
      throw new UnauthorizedException(
        'A verified Keycloak token or authorization code is required',
      );
    }

    const claims = await this.keycloakService.verifyKeycloakToken(token);
    const email = (claims.email || claims.preferred_username!).toLowerCase();
    const name = claims.name || claims.given_name || email.split('@')[0];
    const role = this.keycloakService.extractRole(claims) || 'member';

    // Resolve or create tenant organization
    const orgNameClaim =
      claims.organization || claims.org || claims.tenant || claims.workspace;
    let orgName = orgNameClaim;
    if (!orgName) {
      if (email.includes('@')) {
        const domain = email.split('@')[1];
        const company = domain.split('.')[0];
        const isGeneric = [
          'gmail',
          'yahoo',
          'hotmail',
          'outlook',
          'example',
        ].includes(company.toLowerCase());
        orgName = isGeneric
          ? 'TeamFlow Workspace'
          : `${company.charAt(0).toUpperCase() + company.slice(1)} Workspace`;
      } else {
        orgName = 'TeamFlow Workspace';
      }
    }

    // Provision or sync user in transaction
    const user = await this.prisma.$transaction(async (tx) => {
      let existingOrg = await tx.organization.findFirst({
        where: { name: orgName },
      });
      if (!existingOrg) {
        existingOrg = await tx.organization.create({
          data: {
            name: orgName,
            subscriptionTier: 'growth',
            subscriptionStatus: 'active',
          },
        });
      }

      let existingUser = await tx.user.findUnique({
        where: { email },
      });

      if (!existingUser) {
        const unusableHash = `!sso_keycloak_${randomUUID()}`;
        existingUser = await tx.user.create({
          data: {
            email,
            password: unusableHash,
            name,
            role,
            organizationId: existingOrg.id,
            avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(email)}`,
          },
        });
      } else {
        const updateData: any = {};
        if (role && existingUser.role !== role) updateData.role = role;
        if (!existingUser.organizationId)
          updateData.organizationId = existingOrg.id;
        if (Object.keys(updateData).length > 0) {
          existingUser = await tx.user.update({
            where: { id: existingUser.id },
            data: updateData,
          });
        }
      }

      return existingUser;
    });

    const tokens = this.generateTokens(user.id, user.email, user.role);
    const serializedUser = await this.serializeUser(user.id);

    return {
      ...tokens,
      user: serializedUser,
    };
  }
}
