import {
  Injectable,
  ForbiddenException,
  ServiceUnavailableException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { randomUUID } from 'node:crypto';

@Injectable()
export class BillingService {
  constructor(private prisma: PrismaService) {}

  private isPrivileged(user: any): boolean {
    return (
      user.isStaff ||
      user.isSuperuser ||
      ['ceo', 'tech_lead', 'admin'].includes(user.role)
    );
  }

  private requireMockBilling(user: any) {
    if (!this.isPrivileged(user) || !user.organizationId) {
      throw new ForbiddenException(
        'A privileged workspace account is required',
      );
    }
    const env = process.env.NODE_ENV || '';
    if (
      !['development', 'test'].includes(env) ||
      process.env.ALLOW_MOCK_BILLING !== 'true'
    ) {
      throw new ServiceUnavailableException(
        'Billing provider is not configured; mock billing is disabled',
      );
    }
  }

  private validateTier(tier: string) {
    if (!['starter', 'growth', 'scale', 'enterprise'].includes(tier))
      throw new BadRequestException('Invalid subscription tier');
  }

  async createCheckoutSession(
    user: any,
    tier = 'growth',
    successUrl?: string,
    cancelUrl?: string,
  ) {
    this.validateTier(tier);
    this.requireMockBilling(user);

    const defaultSuccess =
      successUrl || 'http://localhost:3000/billing?success=true';
    const defaultCancel =
      cancelUrl || 'http://localhost:3000/billing?canceled=true';
    const mockSessionId = `cs_mock_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const sep = defaultSuccess.includes('?') ? '&' : '?';
    const checkoutUrl = `${defaultSuccess}${sep}session_id=${mockSessionId}&tier=${tier}`;

    return {
      id: mockSessionId,
      url: checkoutUrl,
      checkout_url: checkoutUrl,
      mock: true,
      tier,
      success_url: defaultSuccess,
      cancel_url: defaultCancel,
    };
  }

  async createPortalSession(user: any, returnUrl?: string) {
    this.requireMockBilling(user);

    const defaultReturn = returnUrl || 'http://localhost:3000/billing';
    const mockPortalId = `portal_mock_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

    return {
      id: mockPortalId,
      url: defaultReturn,
      portal_url: defaultReturn,
      mock: true,
    };
  }

  async mockConfirm(user: any, tier = 'growth') {
    this.validateTier(tier);
    this.requireMockBilling(user);

    const org = await this.prisma.organization.update({
      where: { id: user.organizationId },
      data: {
        subscriptionTier: tier,
        subscriptionStatus: 'active',
        stripeCustomerId: `cus_mock_${user.organizationId}`,
        stripeSubscriptionId: `sub_mock_${user.organizationId}`,
      },
    });

    return {
      mock: true,
      status: 'success',
      tier: org.subscriptionTier,
      subscription_status: org.subscriptionStatus,
    };
  }
}
