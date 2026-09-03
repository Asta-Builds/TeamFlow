import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BillingService } from './billing.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private billingService: BillingService) {}

  @Post('create-checkout-session')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create Stripe checkout session for subscription tier' })
  async createCheckoutSession(
    @CurrentUser() user: any,
    @Body('tier') tier?: string,
    @Body('success_url') success_url?: string,
    @Body('cancel_url') cancel_url?: string,
  ) {
    return this.billingService.createCheckoutSession(user, tier, success_url, cancel_url);
  }

  @Post('customer-portal')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create Stripe customer billing portal session' })
  async createPortalSession(
    @CurrentUser() user: any,
    @Body('return_url') return_url?: string,
  ) {
    return this.billingService.createPortalSession(user, return_url);
  }

  @Post('mock-confirm')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Instantly update organization subscription tier (mock/dev)' })
  async mockConfirm(
    @CurrentUser() user: any,
    @Body('tier') tier?: string,
  ) {
    return this.billingService.mockConfirm(user, tier);
  }
}
