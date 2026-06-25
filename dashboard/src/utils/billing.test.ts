import { describe, it, expect, beforeEach } from 'vitest';
import { redeemCoupon, setActiveVehicleTier, MOCK_COUPONS } from './billing';

beforeEach(() => {
  localStorage.removeItem('tier');
  localStorage.removeItem('lt_vehicle_tier');
});

describe('redeemCoupon', () => {
  it('applies the mapped tier for a valid code', () => {
    const r = redeemCoupon('GUARDIANBASIC');
    expect(r).toMatchObject({ ok: true, tier: 'basic' });
    expect(localStorage.getItem('lt_vehicle_tier')).toBe('basic');
    expect(localStorage.getItem('tier')).toBe('basic');
  });

  it('is case-insensitive and trims', () => {
    expect(redeemCoupon('  guardianpremium ')).toMatchObject({ ok: true, tier: 'premium' });
    expect(localStorage.getItem('lt_vehicle_tier')).toBe('premium');
  });

  it('rejects an unknown code without changing the tier', () => {
    const r = redeemCoupon('NOPE');
    expect(r.ok).toBe(false);
    expect(localStorage.getItem('lt_vehicle_tier')).toBeNull();
  });

  it('fires tier_updated so useEntitlements refreshes', () => {
    let fired = false;
    const h = () => { fired = true; };
    window.addEventListener('tier_updated', h);
    redeemCoupon('GUARDIANBASIC');
    window.removeEventListener('tier_updated', h);
    expect(fired).toBe(true);
  });
});

describe('setActiveVehicleTier', () => {
  it('ignores invalid tiers', () => {
    setActiveVehicleTier('gold' as any);
    expect(localStorage.getItem('lt_vehicle_tier')).toBeNull();
  });
  it('mock coupons cover all three tiers', () => {
    expect(new Set(Object.values(MOCK_COUPONS))).toEqual(new Set(['free', 'basic', 'premium']));
  });
});
