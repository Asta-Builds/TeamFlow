import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { ClerkService } from '../auth/clerk.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ACTIVE_SEATS, withActiveSeat } from '../common/workspace.js';

export const MCP_READ_SCOPE = 'teamflow.read';
export const MCP_WRITE_SCOPE = 'teamflow.write';

@Injectable()
export class McpPrincipalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clerkService: ClerkService,
  ) {}

  async resolve(authInfo: AuthInfo | undefined, requiresWrite: boolean) {
    if (!authInfo) {
      throw new UnauthorizedException('A verified MCP OAuth token is required');
    }

    const hasRequiredScope = requiresWrite
      ? authInfo.scopes.includes(MCP_WRITE_SCOPE)
      : authInfo.scopes.includes(MCP_READ_SCOPE) ||
        authInfo.scopes.includes(MCP_WRITE_SCOPE);
    if (!hasRequiredScope) {
      throw new ForbiddenException(
        `Missing required OAuth scope: ${
          requiresWrite ? MCP_WRITE_SCOPE : MCP_READ_SCOPE
        }`,
      );
    }

    const clerkId = authInfo.extra?.userId;
    if (typeof clerkId !== 'string' || !clerkId) {
      throw new UnauthorizedException('Clerk OAuth token did not identify a user');
    }

    const linkedUser = await this.prisma.user.findUnique({
      where: { clerkId },
      include: { memberships: ACTIVE_SEATS },
    });
    if (linkedUser) return this.requireActiveWorkspace(linkedUser);

    const clerkProfile = await this.clerkService.getUserProfile(clerkId);
    const linkedByEmail = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { email: clerkProfile.email },
      });
      if (!user) {
        throw new ForbiddenException(
          'No TeamFlow account is linked to this Clerk OAuth user. Sign in to TeamFlow first.',
        );
      }
      if (user.clerkId && user.clerkId !== clerkId) {
        throw new ForbiddenException(
          'This TeamFlow account is linked to a different Clerk identity.',
        );
      }
      return tx.user.update({
        where: { id: user.id },
        data: { clerkId },
        include: { memberships: ACTIVE_SEATS },
      });
    });

    return this.requireActiveWorkspace(linkedByEmail);
  }

  private requireActiveWorkspace<T extends {
    id: number;
    role: string;
    agentKey: string;
    isActive: boolean;
    organizationId: number | null;
    memberships: { organizationId: number; role: string }[];
  }>(user: T): T {
    if (!user.isActive || user.agentKey) {
      throw new ForbiddenException('This TeamFlow account is disabled');
    }
    if (!withActiveSeat(user).organizationId) {
      throw new ForbiddenException('This TeamFlow account has no active workspace');
    }
    return user;
  }
}
