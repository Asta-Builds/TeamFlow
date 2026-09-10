import { describe, expect, it, vi } from 'vitest';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  McpPrincipalService,
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE,
} from './mcp-principal.service.js';

const activeUser = {
  id: 7,
  email: 'member@example.com',
  clerkId: 'user_existing',
  isActive: true,
  organizationId: 3,
  role: 'member',
};

function auth(scopes: string[], userId = 'user_existing'): AuthInfo {
  return {
    token: 'verified-oauth-token',
    clientId: 'approved-client',
    scopes,
    extra: { userId },
  };
}

describe('McpPrincipalService', () => {
  it('uses the durable Clerk identity link for an authorized user', async () => {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue(activeUser) },
    };
    const clerk = { getUserProfile: vi.fn() };
    const service = new McpPrincipalService(prisma as any, clerk as any);

    await expect(service.resolve(auth([MCP_READ_SCOPE]), false)).resolves.toEqual(activeUser);
    expect(clerk.getUserProfile).not.toHaveBeenCalled();
  });

  it('requires the write scope for mutations', async () => {
    const prisma = { user: { findUnique: vi.fn() } };
    const clerk = { getUserProfile: vi.fn() };
    const service = new McpPrincipalService(prisma as any, clerk as any);

    await expect(service.resolve(auth([MCP_READ_SCOPE]), true)).rejects.toThrow(
      MCP_WRITE_SCOPE,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('links an existing account by verified Clerk email exactly once', async () => {
    const unlinkedUser = { ...activeUser, clerkId: null };
    const updatedUser = { ...activeUser, clerkId: 'user_new' };
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue(unlinkedUser),
        update: vi.fn().mockResolvedValue(updatedUser),
      },
    };
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (operation: any) => operation(tx)),
    };
    const clerk = {
      getUserProfile: vi.fn().mockResolvedValue({
        clerk_id: 'user_new',
        email: activeUser.email,
        name: 'Member',
      }),
    };
    const service = new McpPrincipalService(prisma as any, clerk as any);

    await expect(
      service.resolve(auth([MCP_READ_SCOPE], 'user_new'), false),
    ).resolves.toEqual(updatedUser);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: activeUser.id },
      data: { clerkId: 'user_new' },
    });
  });

  it('refuses to provision a TeamFlow account from an OAuth connection', async () => {
    const tx = { user: { findUnique: vi.fn().mockResolvedValue(null) } };
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (operation: any) => operation(tx)),
    };
    const clerk = {
      getUserProfile: vi.fn().mockResolvedValue({
        clerk_id: 'user_new',
        email: 'new@example.com',
        name: 'New User',
      }),
    };
    const service = new McpPrincipalService(prisma as any, clerk as any);

    await expect(
      service.resolve(auth([MCP_READ_SCOPE], 'user_new'), false),
    ).rejects.toThrow('No TeamFlow account');
  });
});
