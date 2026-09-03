import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
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

  async createCheckoutSession(user: any, tier = 'growth', successUrl?: string, cancelUrl?: string) {
    if (!this.isPrivileged(user)) {
      throw new ForbiddenException('Only HR admins can manage subscriptions.');
    }

    // Return checkout session URL (supports mock fallback if Stripe secret is not present)
    return {
      checkout_url: `http://localhost:3000/settings/billing?mock_checkout=true&tier=${tier}`,
      tier,
      success_url: successUrl || 'http://localhost:3000/settings/billing',
      cancel_url: cancelUrl || 'http://localhost:3000/settings/billing',
    };
  }

  async createPortalSession(user: any, returnUrl?: string) {
    if (!this.isPrivileged(user)) {
      throw new ForbiddenException('Only HR admins can manage subscriptions.');
    }

    return {
      portal_url: returnUrl || 'http://localhost:3000/settings/billing',
    };
  }

  async mockConfirm(user: any, tier = 'growth') {
    if (!this.isPrivileged(user)) {
      throw new ForbiddenException('Only HR admins can manage subscriptions.');
    }

    if (!user.organizationId) {
      throw new NotFoundException('No organization associated with user');
    }

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
      status: 'success',
      tier: org.subscriptionTier,
      subscription_status: org.subscriptionStatus,
    };
  }
}
