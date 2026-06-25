import { describe, it, expect } from 'vitest';
import {
  getVehicleTier,
  getEntitlements,
  tierAtLeast,
  automationAtLeast,
  isTier,
  TIER_FEATURES,
  GRANDFATHERED_TIER,
  TIER_PRICING,
  BASIC_TRIAL_DAYS,
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
  it('free: manual pull-only remote view, no control/push/automation', () => {
    const e = TIER_FEATURES.free;
    expect(e.canRemoteView).toBe(true);
    expect(e.remoteViewManualOnly).toBe(true);
    expect(e.remoteRefreshMinIntervalSec).toBeGreaterThanOrEqual(120); // within the 2–5 min band
    expect(e.remoteRefreshMinIntervalSec).toBeLessThanOrEqual(300);
    expect(e.canRemoteControl).toBe(false);
    expect(e.canAwayPush).toBe(false);
    expect(e.canCloudFloodShutoff).toBe(false);
    expect(e.automationLevel).toBe('none');
    expect(e.historyRetentionDays).toBe(0);
    expect(e.canCloudSync).toBe(true);
    expect(e.canShare).toBe(true);
  });

  it('basic: auto remote view + remote control + push + cloud shutoff + essential automation', () => {
    const e = TIER_FEATURES.basic;
    expect(e.remoteViewManualOnly).toBe(false);
    expect(e.canRemoteControl).toBe(true);
    expect(e.canAwayPush).toBe(true);
    expect(e.canCloudFloodShutoff).toBe(true);
    expect(e.automationLevel).toBe('essential');
    expect(e.historyRetentionDays).toBe(30);
    expect(e.canSmsAlert).toBe(false);
    expect(e.canExport).toBe(false);
    expect(e.canIntegrations).toBe(false);
  });

  it('premium: advanced automation + sms + long history + export + integrations + support', () => {
    const e = TIER_FEATURES.premium;
    expect(e.automationLevel).toBe('advanced');
    expect(e.canSmsAlert).toBe(true);
    expect(e.historyRetentionDays).toBe(1095);
    expect(e.canExport).toBe(true);
    expect(e.canIntegrations).toBe(true);
    expect(e.prioritySupport).toBe(true);
  });

  it('history retention and telemetry resolution improve up the ladder', () => {
    expect(TIER_FEATURES.free.historyRetentionDays).toBeLessThan(TIER_FEATURES.basic.historyRetentionDays);
    expect(TIER_FEATURES.basic.historyRetentionDays).toBeLessThan(TIER_FEATURES.premium.historyRetentionDays);
    // lower resolution number = more frequent persistence = better
    expect(TIER_FEATURES.premium.telemetryResolutionSec).toBeLessThan(TIER_FEATURES.basic.telemetryResolutionSec);
    expect(TIER_FEATURES.basic.telemetryResolutionSec).toBeLessThan(TIER_FEATURES.free.telemetryResolutionSec);
  });
});

describe('getEntitlements', () => {
  it('legacy vehicle (no tier) is grandfathered to full access — no behavior change', () => {
    const e = getEntitlements({ lt_vessel_name: 'Old Boat' });
    expect(e.canRemoteControl).toBe(true); // would break existing owners if false
    expect(e).toBe(TIER_FEATURES[GRANDFATHERED_TIER]);
  });

  it('a free-tier vehicle cannot remote-control', () => {
    expect(getEntitlements({ tier: 'free' }).canRemoteControl).toBe(false);
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

describe('automationAtLeast', () => {
  it('orders none < essential < advanced', () => {
    expect(automationAtLeast('advanced', 'essential')).toBe(true);
    expect(automationAtLeast('essential', 'essential')).toBe(true);
    expect(automationAtLeast('none', 'essential')).toBe(false);
    expect(automationAtLeast('essential', 'advanced')).toBe(false);
  });
});

describe('isTier', () => {
  it('validates tier strings', () => {
    expect(isTier('free')).toBe(true);
    expect(isTier('enterprise')).toBe(false);
    expect(isTier(null)).toBe(false);
  });
});

describe('pricing & trial', () => {
  it('matches the agreed prices', () => {
    expect(TIER_PRICING.free).toEqual({ monthly: 0, yearly: 0 });
    expect(TIER_PRICING.basic).toEqual({ monthly: 3, yearly: 12 });
    expect(TIER_PRICING.premium).toEqual({ monthly: 5, yearly: 30 });
  });
  it('offers a one-month Basic trial', () => {
    expect(BASIC_TRIAL_DAYS).toBe(30);
  });
});
