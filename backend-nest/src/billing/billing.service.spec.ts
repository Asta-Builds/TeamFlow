import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BillingService } from './billing.service.js';

describe('BillingService', () => {
  let service: BillingService;
  let prismaMock: any;

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ALLOW_MOCK_BILLING', 'true');

    prismaMock = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          id: 1,
          name: 'Test Org',
          subscriptionTier: 'starter',
          subscriptionStatus: 'active',
        }),
        update: vi.fn().mockResolvedValue({
          id: 1,
          name: 'Test Org',
          subscriptionTier: 'enterprise',
          subscriptionStatus: 'active',
        }),
      },
    };
    service = new BillingService(prismaMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates checkout session in mock mode without throwing 503', async () => {
    const user = { id: 1, organizationId: 1, role: 'ceo' };
    const res = await service.createCheckoutSession(user, 'growth');

    expect(res.mock).toBe(true);
    expect(res.tier).toBe('growth');
    expect(res.url).toContain('billing');
    expect(res.checkout_url).toBe(res.url);
    expect(res.id).toMatch(/^cs_mock_/);
  });

  it('creates customer portal session without error', async () => {
    const user = { id: 1, organizationId: 1, role: 'ceo' };
    const res = await service.createPortalSession(user, 'http://localhost:3000/billing');

    expect(res.mock).toBe(true);
    expect(res.url).toBe('http://localhost:3000/billing');
    expect(res.id).toMatch(/^portal_mock_/);
  });

  it('confirms mock upgrade and updates organization', async () => {
    const user = { id: 1, organizationId: 1, role: 'ceo' };
    const res = await service.mockConfirm(user, 'enterprise');

    expect(res.mock).toBe(true);
    expect(res.tier).toBe('enterprise');
    expect(prismaMock.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({
          subscriptionTier: 'enterprise',
          subscriptionStatus: 'active',
        }),
      }),
    );
  });

  it('rejects invalid subscription tiers', async () => {
    const user = { id: 1, organizationId: 1, role: 'ceo' };
    await expect(service.createCheckoutSession(user, 'ultra_tier')).rejects.toThrow(
      'Invalid subscription tier',
    );
  });

  it('rejects users without organization', async () => {
    const user = { id: 1, role: 'ceo' };
    await expect(service.createCheckoutSession(user, 'growth')).rejects.toThrow(
      'A privileged workspace account is required',
    );
  });
});
