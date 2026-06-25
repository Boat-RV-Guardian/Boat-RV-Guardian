import { describe, it, expect } from 'vitest';
import {
  getVehicleTier,
  getEntitlements,
  tierAtLeast,
  isTier,
  TIER_FEATURES,
  GRANDFATHERED_TIER,
  TIER_PRICING,
} from './entitlements';

describe('getVehicleTier', () => {
  it('reads a valid stored tier', () => {
    expect(getVehicleTier({ tier: 'free' })).toBe('free');
    expect(getVehicleTier({ tier: 'basic' })).toBe('basic');
    expect(getVehicleTier({ tier: 'premium' })).toBe('premium');
  });

  it('falls back to the grandfathered tier for legacy/unset vehicles', () => {
    expect(getVehicleTier({})).toBe(GRANDFATHERED_TIER);
    expect(getVehicleTier(null)).toBe(GRANDFATHERED_TIER);
    expect(getVehicleTier(undefined)).toBe(GRANDFATHERED_TIER);
  });

  it('falls back on invalid stored values (defensive)', () => {
    expect(getVehicleTier({ tier: 'gold' })).toBe(GRANDFATHERED_TIER);
    expect(getVehicleTier({ tier: 42 })).toBe(GRANDFATHERED_TIER);
    expect(getVehicleTier({ tier: '' })).toBe(GRANDFATHERED_TIER);
  });
});

describe('tier feature matrix', () => {
  it('free is monitor-only: sync + sharing, no control/actions/sms', () => {
    const e = TIER_FEATURES.free;
    expect(e.canControl).toBe(false);
    expect(e.canCloudActions).toBe(false);
    expect(e.canCloudSync).toBe(true);
    expect(e.canShare).toBe(true);
    expect(e.canSmsAlert).toBe(false);
    expect(e.historyRetentionDays).toBe(0);
    expect(e.prioritySupport).toBe(false);
  });

  it('basic adds control + ~1 month history, no sms', () => {
    const e = TIER_FEATURES.basic;
    expect(e.canControl).toBe(true);
    expect(e.canCloudActions).toBe(true);
    expect(e.historyRetentionDays).toBe(30);
    expect(e.canSmsAlert).toBe(false);
    expect(e.prioritySupport).toBe(false);
  });

  it('premium adds long history + sms + support', () => {
    const e = TIER_FEATURES.premium;
    expect(e.canControl).toBe(true);
    expect(e.historyRetentionDays).toBe(1095);
    expect(e.canSmsAlert).toBe(true);
    expect(e.prioritySupport).toBe(true);
  });

  it('history retention is monotonic across tiers', () => {
    expect(TIER_FEATURES.free.historyRetentionDays).toBeLessThan(TIER_FEATURES.basic.historyRetentionDays);
    expect(TIER_FEATURES.basic.historyRetentionDays).toBeLessThan(TIER_FEATURES.premium.historyRetentionDays);
  });
});

describe('getEntitlements', () => {
  it('legacy vehicle (no tier) is grandfathered to full access — no behavior change', () => {
    const e = getEntitlements({ lt_vessel_name: 'Old Boat' });
    expect(e.canControl).toBe(true); // would break existing owners if false
    expect(e).toBe(TIER_FEATURES[GRANDFATHERED_TIER]);
  });

  it('a free-tier vehicle cannot control', () => {
    expect(getEntitlements({ tier: 'free' }).canControl).toBe(false);
  });
});

describe('tierAtLeast', () => {
  it('orders free < basic < premium', () => {
    expect(tierAtLeast('premium', 'basic')).toBe(true);
    expect(tierAtLeast('basic', 'basic')).toBe(true);
    expect(tierAtLeast('free', 'basic')).toBe(false);
    expect(tierAtLeast('basic', 'premium')).toBe(false);
  });
});

describe('isTier', () => {
  it('validates tier strings', () => {
    expect(isTier('free')).toBe(true);
    expect(isTier('enterprise')).toBe(false);
    expect(isTier(null)).toBe(false);
  });
});

describe('pricing', () => {
  it('matches the agreed prices', () => {
    expect(TIER_PRICING.free).toEqual({ monthly: 0, yearly: 0 });
    expect(TIER_PRICING.basic).toEqual({ monthly: 3, yearly: 12 });
    expect(TIER_PRICING.premium).toEqual({ monthly: 5, yearly: 30 });
  });
});
