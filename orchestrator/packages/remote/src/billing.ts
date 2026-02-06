/**
 * Billing service
 * Translates: crates/remote/src/billing.rs
 *
 * SaaS billing and subscription management.
 */

export enum BillingPlan {
  Free = 'free',
  Pro = 'pro',
  Team = 'team',
  Enterprise = 'enterprise'
}

export interface Subscription {
  id: string;
  userId: string;
  organizationId?: string;
  plan: BillingPlan;
  status: 'active' | 'cancelled' | 'past_due' | 'trialing';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

export interface BillingCheckError {
  message: string;
  code: string;
}

export class BillingService {
  // TODO: Implement billing service
  async createSubscription(userId: string, plan: BillingPlan): Promise<Subscription> {
    throw new Error('Not implemented');
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    throw new Error('Not implemented');
  }

  async getSubscription(userId: string): Promise<Subscription | null> {
    throw new Error('Not implemented');
  }

  async checkUsageLimit(userId: string, resource: string): Promise<boolean> {
    throw new Error('Not implemented');
  }
}
