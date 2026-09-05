import {
  Injectable,
  ForbiddenException,
  ServiceUnavailableException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

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
    if (
      !['development', 'test'].includes(process.env.NODE_ENV || '') ||
      process.env.ALLOW_MOCK_BILLING !== 'true'
    ) {
      throw new ServiceUnavailableException(
        'Billing provider is not configured; mock billing is disabled',
      );
    }
  }

  private validateTier(tier: string) {
    if (!['starter', 'growth', 'enterprise'].includes(tier))
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

    // Explicit development-only simulation.
    return {
      mock: true,
      checkout_url: `http://localhost:3000/settings/billing?mock_checkout=true&tier=${tier}`,
      tier,
      success_url: successUrl || 'http://localhost:3000/settings/billing',
      cancel_url: cancelUrl || 'http://localhost:3000/settings/billing',
    };
  }

  async createPortalSession(user: any, returnUrl?: string) {
    this.requireMockBilling(user);

    return {
      mock: true,
      portal_url: returnUrl || 'http://localhost:3000/settings/billing',
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
