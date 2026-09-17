import {
  Injectable,
  ForbiddenException,
  ServiceUnavailableException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service.js';
import { randomUUID } from 'node:crypto';
import { bridgePost } from '../common/python-bridge.js';

/**
 * Stripe checkout and the customer portal are served by the Django service
 * (which also receives Stripe webhooks). Mock billing exists only for local
 * development with ALLOW_MOCK_BILLING=true.
 */
@Injectable()
export class BillingService {
  constructor(
    private prisma: PrismaService,
    @Optional() private httpService?: HttpService,
  ) {}

  private mockBillingAllowed(): boolean {
    return (
      ['development', 'test'].includes(process.env.NODE_ENV || '') &&
      process.env.ALLOW_MOCK_BILLING === 'true'
    );
  }

  private requirePrivilegedWorkspace(user: any) {
    if (!this.isPrivileged(user) || !user.organizationId) {
      throw new ForbiddenException('A privileged workspace account is required');
    }
  }

  private async viaStripe(user: any, path: string, body: Record<string, unknown>) {
    if (!this.httpService) {
      throw new ServiceUnavailableException('Billing provider is not configured');
    }
    const result = await bridgePost(this.httpService, user, path, body);
    if (result.status === 502) {
      throw new ServiceUnavailableException('The billing provider rejected the request');
    }
    return result.data;
  }

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

  private requireRedirectUrl(url: string | undefined, field: string): string {
    if (!url) {
      throw new BadRequestException(`${field} must be provided by the client`);
    }
    try {
      return new URL(url).toString();
    } catch {
      throw new BadRequestException(`${field} must be an absolute URL`);
    }
  }

  async createCheckoutSession(
    user: any,
    tier = 'growth',
    successUrl?: string,
    cancelUrl?: string,
  ) {
    this.validateTier(tier);
    this.requirePrivilegedWorkspace(user);
    const defaultSuccess = this.requireRedirectUrl(successUrl, 'success_url');
    const defaultCancel = this.requireRedirectUrl(cancelUrl, 'cancel_url');
    if (!this.mockBillingAllowed()) {
      return this.viaStripe(user, '/api/billing/create-checkout-session/', {
        tier,
        success_url: defaultSuccess,
        cancel_url: defaultCancel,
      });
    }
    this.requireMockBilling(user);

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
    this.requirePrivilegedWorkspace(user);
    const defaultReturn = this.requireRedirectUrl(returnUrl, 'return_url');
    if (!this.mockBillingAllowed()) {
      return this.viaStripe(user, '/api/billing/customer-portal/', {
        return_url: defaultReturn,
      });
    }
    this.requireMockBilling(user);

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
