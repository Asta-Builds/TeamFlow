import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrganizationsService } from './organizations.service.js';

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let prismaMock: any;
  let authServiceMock: any;

  beforeEach(() => {
    prismaMock = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          id: 10,
          name: 'Acme Space',
          subscriptionTier: 'growth',
          subscriptionStatus: 'active',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 10,
            name: 'Acme Space',
            subscriptionTier: 'growth',
            subscriptionStatus: 'active',
            createdAt: new Date('2026-01-01T00:00:00Z'),
          },
        ]),
        create: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 99,
            ...data,
            createdAt: new Date(),
          }),
        ),
        update: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 10,
            name: data.name || 'Acme Space',
            subscriptionTier: 'growth',
            subscriptionStatus: 'active',
            createdAt: new Date('2026-01-01T00:00:00Z'),
          }),
        ),
      },
      user: {
        count: vi.fn().mockResolvedValue(5),
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 201,
            ...data,
          }),
        ),
        update: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 1,
            email: 'ceo@acme.com',
            role: data.role || 'ceo',
            organizationId: data.organizationId || 10,
          }),
        ),
      },
      project: { count: vi.fn().mockResolvedValue(3) },
      task: { count: vi.fn().mockResolvedValue(12) },
      deployment: { count: vi.fn().mockResolvedValue(4) },
      sEOAudit: { count: vi.fn().mockResolvedValue(2) },
    };

    authServiceMock = {
      generateTokens: vi.fn().mockReturnValue({
        access: 'mock_access_token',
        refresh: 'mock_refresh_token',
      }),
      serializeUser: vi.fn().mockResolvedValue({
        id: 1,
        email: 'ceo@acme.com',
        organization: 10,
      }),
    };

    service = new OrganizationsService(prismaMock, authServiceMock);
  });

  describe('getCurrent()', () => {
    it('returns organization details with computed metrics and tier limits', async () => {
      const user = { id: 1, organizationId: 10, role: 'ceo' };
      const res = await service.getCurrent(user);

      expect(res.id).toBe(10);
      expect(res.name).toBe('Acme Space');
      expect(res.subscription_tier).toBe('growth');
      expect(res.metrics.members_count).toBe(5);
      expect(res.metrics.projects_count).toBe(3);
      expect(res.limits.ai_agent_swarm).toBe(true);
    });

    it('throws NotFoundException if user has no organization', async () => {
      const user = { id: 1, role: 'ceo' };
      await expect(service.getCurrent(user)).rejects.toThrow(
        'User does not belong to an active organization',
      );
    });
  });

  describe('updateCurrent()', () => {
    it('updates organization name when requested by privileged user', async () => {
      const user = { id: 1, organizationId: 10, role: 'ceo' };
      const res = await service.updateCurrent(user, { name: 'Acme Worldwide' });

      expect(prismaMock.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 10 },
          data: { name: 'Acme Worldwide' },
        }),
      );
      expect(res.id).toBe(10);
    });

    it('rejects update from non-privileged member', async () => {
      const user = { id: 2, organizationId: 10, role: 'member' };
      await expect(
        service.updateCurrent(user, { name: 'Hacked Name' }),
      ).rejects.toThrow('Only workspace administrators can modify organization settings');
    });
  });

  describe('create()', () => {
    it('creates a new tenant organization and assigns creator as CEO', async () => {
      const user = { id: 1, email: 'ceo@acme.com', role: 'member' };
      const res = await service.create(user, {
        name: 'New Horizon Labs',
        tier: 'growth',
      });

      expect(prismaMock.organization.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'New Horizon Labs',
            subscriptionTier: 'growth',
          }),
        }),
      );
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: { organizationId: 99, role: 'ceo' },
        }),
      );
      expect(res.access).toBe('mock_access_token');
    });
  });

  describe('inviteMember()', () => {
    it('provisions a new pending member in current tenant', async () => {
      const user = { id: 1, organizationId: 10, role: 'ceo' };
      const res = await service.inviteMember(user, {
        email: 'dev@acme.com',
        role: 'frontend',
      });

      expect(prismaMock.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'dev@acme.com',
            organizationId: 10,
            role: 'frontend',
            userStatus: 'pending',
          }),
        }),
      );
      expect(res.email).toBe('dev@acme.com');
    });
  });
});
