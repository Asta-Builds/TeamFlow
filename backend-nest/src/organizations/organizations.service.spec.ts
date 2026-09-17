import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrganizationsService } from './organizations.service.js';

const acme = {
  id: 10,
  name: 'Acme Space',
  subscriptionTier: 'growth',
  subscriptionStatus: 'active',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};
const globex = { ...acme, id: 20, name: 'Globex' };

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let prismaMock: any;
  let authServiceMock: any;

  beforeEach(() => {
    prismaMock = {
      organization: {
        findUnique: vi.fn().mockResolvedValue(acme),
        findMany: vi.fn().mockResolvedValue([globex]),
        create: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: 99, ...data, createdAt: new Date() }),
        ),
        update: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({ ...acme, name: data.name || acme.name }),
        ),
      },
      membership: {
        count: vi.fn().mockResolvedValue(5),
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 500, ...data })),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 500, ...data })),
        delete: vi.fn().mockResolvedValue({}),
      },
      projectMember: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      user: {
        count: vi.fn().mockResolvedValue(5),
        findUnique: vi.fn().mockResolvedValue(null),
        findUniqueOrThrow: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: 201, ...data }),
        ),
        update: vi.fn().mockImplementation(({ where, data }) =>
          Promise.resolve({ id: where.id, email: 'ceo@acme.com', role: 'ceo', ...data }),
        ),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      project: { count: vi.fn().mockResolvedValue(3) },
      task: { count: vi.fn().mockResolvedValue(12) },
      deployment: { count: vi.fn().mockResolvedValue(4) },
      sEOAudit: { count: vi.fn().mockResolvedValue(2) },
    };
    prismaMock.$transaction = vi.fn((fn: any) => fn(prismaMock));

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
    it('returns organization details with seat counts and tier limits', async () => {
      const user = { id: 1, organizationId: 10, role: 'ceo' };
      const res = await service.getCurrent(user);

      expect(res.id).toBe(10);
      expect(res.name).toBe('Acme Space');
      expect(res.role).toBe('ceo');
      expect(res.subscription_tier).toBe('growth');
      expect(res.metrics.members_count).toBe(5);
      expect(prismaMock.membership.count).toHaveBeenCalledWith({
        where: { organizationId: 10, status: 'active' },
      });
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
    it('founds a workspace with the creator as CEO', async () => {
      const user = { id: 1, email: 'ceo@acme.com', role: 'member', organizationId: 10 };
      const res = await service.create(user, {
        name: 'New Horizon Labs',
        tier: 'growth',
      });

      // A requested paid tier is ignored; billing grants tiers.
      expect(prismaMock.organization.create).toHaveBeenCalledWith({
        data: {
          name: 'New Horizon Labs',
          subscriptionTier: 'starter',
          subscriptionStatus: 'active',
          memberships: { create: { userId: 1, role: 'ceo' } },
        },
      });
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { organizationId: 99, role: 'ceo' },
      });
      // Other workspaces are kept.
      expect(prismaMock.membership.delete).not.toHaveBeenCalled();
      expect(res.access).toBe('mock_access_token');
    });
  });

  describe('findAll()', () => {
    it("lists the caller's workspaces and invitations", async () => {
      prismaMock.membership.findMany.mockResolvedValue([
        { organizationId: 10, role: 'ceo', status: 'active', organization: acme, invitedBy: null },
        {
          organizationId: 20,
          role: 'member',
          status: 'invited',
          organization: globex,
          invitedBy: { name: 'Gina', email: 'gina@globex.com' },
        },
      ]);
      const rows = await service.findAll({ id: 1, organizationId: 10, role: 'ceo' });

      expect(prismaMock.membership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 1 } }),
      );
      expect(prismaMock.organization.findMany).not.toHaveBeenCalled();
      expect(rows).toEqual([
        expect.objectContaining({ id: 10, role: 'ceo', membership_status: 'active', is_current: true }),
        expect.objectContaining({
          id: 20,
          role: 'member',
          membership_status: 'invited',
          invited_by: 'Gina',
          is_current: false,
        }),
      ]);
    });

    it('shows platform staff every workspace', async () => {
      const rows = await service.findAll({ id: 1, organizationId: 10, role: 'member', isStaff: true });
      expect(prismaMock.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { notIn: [] } } }),
      );
      expect(rows).toEqual([expect.objectContaining({ id: 20, role: null })]);
    });
  });

  describe('switchOrganization()', () => {
    const user = { id: 1, organizationId: 5, role: 'ceo', email: 'someone@acme.com' };

    it.each(['ceo', 'admin', 'tech_lead', 'member'])(
      'prevents a %s without a seat from switching into another workspace',
      async (role) => {
        await expect(service.switchOrganization({ ...user, role }, 10)).rejects.toThrow(
          'do not have access',
        );
        expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
        expect(prismaMock.user.update).not.toHaveBeenCalled();
        expect(authServiceMock.generateTokens).not.toHaveBeenCalled();
      },
    );

    it('switches to a workspace with the role held there', async () => {
      prismaMock.membership.findUnique.mockResolvedValue({
        id: 7,
        organizationId: 10,
        role: 'member',
        status: 'active',
        organization: acme,
      });
      await service.switchOrganization(user, 10);
      expect(prismaMock.membership.update).not.toHaveBeenCalled();
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { organizationId: 10, role: 'member' },
      });
      expect(authServiceMock.generateTokens).toHaveBeenCalledWith(1, 'ceo@acme.com', 'member');
    });

    it('accepts a pending invitation', async () => {
      prismaMock.membership.findUnique.mockResolvedValue({
        id: 7,
        organizationId: 10,
        role: 'admin',
        status: 'invited',
        organization: acme,
      });
      await service.switchOrganization(user, 10);
      expect(prismaMock.membership.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { status: 'active' },
      });
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { organizationId: 10, role: 'admin' } }),
      );
    });

    it('lets platform staff switch workspaces', async () => {
      const staff = { id: 1, organizationId: 5, role: 'member', isStaff: true, email: 'ops@example.com' };
      await service.switchOrganization(staff, 10);
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { organizationId: 10, role: 'member' } }),
      );
    });
  });

  describe('leaveOrganization()', () => {
    it('refuses to let the last CEO leave', async () => {
      prismaMock.membership.findUnique.mockResolvedValue({
        id: 7, userId: 1, organizationId: 10, role: 'ceo', status: 'active',
      });
      prismaMock.membership.count.mockResolvedValue(0);
      await expect(
        service.leaveOrganization({ id: 1, organizationId: 10, role: 'ceo' }, 10),
      ).rejects.toThrow('at least one owner');
      expect(prismaMock.membership.delete).not.toHaveBeenCalled();
    });

    it('moves the person to their next workspace', async () => {
      prismaMock.membership.findUnique.mockResolvedValue({
        id: 7, userId: 1, organizationId: 10, role: 'member', status: 'active',
      });
      prismaMock.user.findUniqueOrThrow.mockResolvedValue({ id: 1, organizationId: 10 });
      prismaMock.membership.findFirst.mockResolvedValue({ organizationId: 20, role: 'ceo' });
      prismaMock.membership.findMany.mockResolvedValue([{ organizationId: 20, role: 'ceo' }]);

      await service.leaveOrganization({ id: 1, organizationId: 10, role: 'member' }, 10);

      expect(prismaMock.membership.delete).toHaveBeenCalledWith({ where: { id: 7 } });
      expect(prismaMock.projectMember.deleteMany).toHaveBeenCalledWith({
        where: { userId: 1, project: { organizationId: 10 } },
      });
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { organizationId: 20, role: 'ceo' },
      });
      expect(prismaMock.organization.create).not.toHaveBeenCalled();
    });
  });

  describe('member management', () => {
    const owner = { id: 1, organizationId: 10, role: 'ceo' };
    const admin = { id: 2, organizationId: 10, role: 'admin' };

    it('changes a role in this workspace only', async () => {
      prismaMock.membership.findUnique.mockResolvedValue({ id: 8, organizationId: 10, role: 'member' });
      await service.updateMemberRole(owner, 3, 'admin');
      expect(prismaMock.membership.update).toHaveBeenCalledWith({ where: { id: 8 }, data: { role: 'admin' } });
      expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
        where: { id: 3, organizationId: 10 },
        data: { role: 'admin' },
      });
    });

    it.each(['backend', 'tech_lead', 'pm', 'superuser'])('refuses the %s role for people', async (role) => {
      await expect(service.updateMemberRole(owner, 3, role)).rejects.toThrow('Unsupported role');
      expect(prismaMock.membership.update).not.toHaveBeenCalled();
    });

    it('lets only owners grant or revoke admin', async () => {
      prismaMock.membership.findUnique.mockResolvedValue({ id: 8, organizationId: 10, role: 'member' });
      await expect(service.updateMemberRole(admin, 3, 'admin')).rejects.toThrow('workspace owners');
      prismaMock.membership.findUnique.mockResolvedValue({ id: 8, organizationId: 10, role: 'admin' });
      await expect(service.updateMemberRole(admin, 3, 'member')).rejects.toThrow('workspace owners');
      expect(prismaMock.membership.update).not.toHaveBeenCalled();
    });

    it('keeps at least one CEO and never changes your own role', async () => {
      await expect(service.updateMemberRole(owner, 1, 'member')).rejects.toThrow('your own role');
      prismaMock.membership.findUnique.mockResolvedValue({ id: 8, organizationId: 10, role: 'ceo' });
      prismaMock.membership.count.mockResolvedValue(0);
      await expect(
        service.updateMemberRole({ ...owner, isStaff: true, id: 99 }, 3, 'member'),
      ).rejects.toThrow('at least one owner');
    });

    it('does not manage AI agent seats', async () => {
      prismaMock.user.findFirst.mockResolvedValue({ id: 30 });
      await expect(service.updateMemberRole(owner, 30, 'member')).rejects.toThrow('AI agent');
      await expect(service.removeMember(owner, 30)).rejects.toThrow('AI agent');
    });

    it('does not reach people outside the workspace', async () => {
      await expect(service.removeMember(owner, 3)).rejects.toThrow('not a member');
      await expect(service.updateMemberRole(owner, 3, 'member')).rejects.toThrow('not a member');
    });

    it('removes a member and their project access here', async () => {
      prismaMock.membership.findUnique.mockResolvedValue({
        id: 8, userId: 3, organizationId: 10, role: 'member', status: 'active',
      });
      prismaMock.user.findUniqueOrThrow.mockResolvedValue({ id: 3, organizationId: 10 });
      await service.removeMember(admin, 3);
      expect(prismaMock.membership.delete).toHaveBeenCalledWith({ where: { id: 8 } });
      expect(prismaMock.projectMember.deleteMany).toHaveBeenCalledWith({
        where: { userId: 3, project: { organizationId: 10 } },
      });
      // No other seat: the person is left without an active workspace.
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 3 },
        data: { organizationId: null, role: 'member' },
      });
    });

    it('refuses removal by members and self-removal', async () => {
      await expect(
        service.removeMember({ id: 4, organizationId: 10, role: 'member' }, 3),
      ).rejects.toThrow('Only workspace admins');
      await expect(service.removeMember(owner, 1)).rejects.toThrow('Leave the workspace');
    });
  });

  describe('inviteMember()', () => {
    const owner = { id: 1, organizationId: 10, role: 'ceo' };

    it('creates a pending invitation for a new email', async () => {
      const res = await service.inviteMember(owner, {
        email: 'Dev@Acme.com',
        role: 'admin',
      });

      const call = prismaMock.user.create.mock.calls[0][0];
      expect(call.data).toMatchObject({
        email: 'dev@acme.com',
        role: 'member',
        userStatus: 'pending',
        memberships: {
          create: { organizationId: 10, role: 'admin', status: 'invited', invitedById: 1 },
        },
      });
      expect(call.data.password).toMatch(/^!invited_/);
      expect(call.data.organizationId).toBeUndefined();
      expect(res).toMatchObject({ email: 'dev@acme.com', role: 'admin', membership_status: 'invited' });
    });

    it('invites an existing account without moving it out of its workspace', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 50,
        email: 'person@other.com',
        organizationId: 99,
        agentKey: '',
        memberships: [],
      });
      const res = await service.inviteMember(owner, { email: 'person@other.com' });
      expect(prismaMock.membership.create).toHaveBeenCalledWith({
        data: { userId: 50, organizationId: 10, role: 'member', status: 'invited', invitedById: 1 },
      });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
      expect(res.membership_status).toBe('invited');
    });

    it('rejects duplicates and AI agent seats', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 50, agentKey: '', memberships: [{ status: 'invited' }],
      });
      await expect(service.inviteMember(owner, { email: 'a@acme.com' })).rejects.toThrow(
        'pending invitation',
      );
      prismaMock.user.findUnique.mockResolvedValue({
        id: 50, agentKey: '', memberships: [{ status: 'active' }],
      });
      await expect(service.inviteMember(owner, { email: 'a@acme.com' })).rejects.toThrow(
        'already a member',
      );
      prismaMock.user.findUnique.mockResolvedValue({ id: 51, agentKey: 'qa', memberships: [] });
      await expect(service.inviteMember(owner, { email: 'a@acme.com' })).rejects.toThrow('AI agent');
      expect(prismaMock.membership.create).not.toHaveBeenCalled();
    });

    it('rejects addresses reserved for agent seats', async () => {
      vi.stubEnv('AGENT_EMAIL_DOMAIN', 'agents.test');
      try {
        await expect(
          service.inviteMember(owner, { email: 'qa+organization-10@agents.test' }),
        ).rejects.toThrow('reserved');
      } finally {
        vi.unstubAllEnvs();
      }
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects AI roles, unknown roles and owner roles granted by non-owners', async () => {
      await expect(
        service.inviteMember(owner, { email: 'a@acme.com', role: 'frontend' }),
      ).rejects.toThrow('Unsupported role');
      await expect(
        service.inviteMember(owner, { email: 'a@acme.com', role: 'superuser' }),
      ).rejects.toThrow('Unsupported role');
      await expect(
        service.inviteMember({ id: 2, organizationId: 10, role: 'admin' }, { email: 'a@acme.com', role: 'admin' }),
      ).rejects.toThrow('workspace owners');
      await expect(
        service.inviteMember({ id: 3, organizationId: 10, role: 'member' }, { email: 'a@acme.com' }),
      ).rejects.toThrow('Only workspace administrators');
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });
  });
});
