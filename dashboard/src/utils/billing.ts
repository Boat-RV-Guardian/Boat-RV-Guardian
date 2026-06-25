// MOCK billing (open-tasks Task 6/14). Lets us test the full per-vehicle entitlement flow BEFORE any
// real Stripe: a coupon code "purchases" a tier for the active vehicle. The entitlement layer is
// provider-agnostic, so swapping this for Stripe later only changes how `tier` gets set.

import { isTier, type Tier } from './entitlements';

/** Mock coupon → tier. Replace with Stripe Checkout/webhook → tier when going live. */
export const MOCK_COUPONS: Record<string, Tier> = {
  GUARDIANBASIC: 'basic',
  GUARDIANPREMIUM: 'premium',
  GUARDIANFREE: 'free', // downgrade/reset for testing
};

export interface CouponResult {
  ok: boolean;
  tier?: Tier;
  error?: string;
}

/** Validate a coupon and, if valid, apply its tier to the active vehicle. */
export function redeemCoupon(code: string): CouponResult {
  const tier = MOCK_COUPONS[code.trim().toUpperCase()];
  if (!tier) return { ok: false, error: 'Invalid or expired code.' };
  setActiveVehicleTier(tier);
  return { ok: true, tier };
}

/**
 * Set the active vehicle's tier. Persists to the per-vehicle config (`tier`, synced like other config)
 * AND stashes `lt_vehicle_tier` for immediate pickup by useEntitlements, firing the events the app
 * already listens to. This is the single seam Stripe will drive later (its webhook → setActiveVehicleTier).
 */
export function setActiveVehicleTier(tier: Tier): void {
  if (!isTier(tier)) return;
  localStorage.setItem('tier', tier);              // per-vehicle config field (synced + backed up)
  localStorage.setItem('lt_vehicle_tier', tier);   // what useEntitlements reads
  window.dispatchEvent(new Event('tier_updated'));
  window.dispatchEvent(new Event('settings_updated')); // persists config + lets SyncModal re-stash
}
