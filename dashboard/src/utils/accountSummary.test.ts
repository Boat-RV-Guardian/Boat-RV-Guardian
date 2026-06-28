import { describe, it, expect } from 'vitest';
import { trialStatus, formatTelemetryResolution, usageRows, vehiclePlanRows } from './accountSummary';
import { TIER_FEATURES } from './entitlements';

const NOW = Date.UTC(2026, 5, 28);
const DAY = 86_400_000;

describe('trialStatus', () => {
  it('reports active with whole days remaining (ceil)', () => {
    expect(trialStatus(NOW + 10 * DAY, NOW)).toEqual({ state: 'active', daysLeft: 10 });
    expect(trialStatus(NOW + DAY + 1, NOW)).toEqual({ state: 'active', daysLeft: 2 }); // ceil
  });
  it('reports expired once past', () => {
    expect(trialStatus(NOW - 1, NOW)).toEqual({ state: 'expired', daysLeft: 0 });
  });
  it('reports none for a missing / non-positive / non-finite marker', () => {
    expect(trialStatus(null, NOW)).toEqual({ state: 'none', daysLeft: 0 });
    expect(trialStatus(undefined, NOW)).toEqual({ state: 'none', daysLeft: 0 });
    expect(trialStatus(0, NOW)).toEqual({ state: 'none', daysLeft: 0 });
    expect(trialStatus(NaN, NOW)).toEqual({ state: 'none', daysLeft: 0 });
  });
});

describe('formatTelemetryResolution', () => {
  it('formats the tier cadences', () => {
    expect(formatTelemetryResolution(60)).toBe('Every minute');
    expect(formatTelemetryResolution(300)).toBe('Every 5 minutes');
    expect(formatTelemetryResolution(1800)).toBe('Every 30 minutes');
    expect(formatTelemetryResolution(3600)).toBe('Every hour');
    expect(formatTelemetryResolution(30)).toBe('Every 30s');
  });
  it('handles bad input', () => {
    expect(formatTelemetryResolution(0)).toBe('—');
    expect(formatTelemetryResolution(NaN)).toBe('—');
  });
});

describe('usageRows', () => {
  it('summarizes data axes + counts for a tier', () => {
    const rows = usageRows(TIER_FEATURES.basic, { vehicleCount: 2, deviceCount: 3 });
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
    expect(byLabel['Telemetry resolution'].value).toBe('Every 5 minutes');
    expect(byLabel['Hosted history'].on).toBe(true); // basic = 30d
    expect(byLabel['Devices on this vehicle'].value).toBe('3');
    expect(byLabel['Vehicles'].value).toBe('2');
  });
  it('marks hosted history off for free (0 retention) and zero counts off', () => {
    const rows = usageRows(TIER_FEATURES.free, { vehicleCount: 0, deviceCount: 0 });
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
    expect(byLabel['Hosted history'].on).toBe(false);
    expect(byLabel['Devices on this vehicle'].on).toBe(false);
  });
});

describe('vehiclePlanRows', () => {
  it('returns [] for an empty map', () => {
    expect(vehiclePlanRows({}, null)).toEqual([]);
  });
  it('resolves names + grandfathers unset tiers, marking + sorting the active vehicle first', () => {
    const map = {
      v1: { config: { lt_vessel_name: 'Zephyr', tier: 'basic' } },
      v2: { config: { lt_vessel_name: 'Anchor', tier: '' } },       // unset → grandfathered premium
      v3: { config: { lt_vessel_name: '', tier: 'free' } },          // blank name
    };
    const rows = vehiclePlanRows(map, 'v3');
    expect(rows[0]).toEqual({ id: 'v3', name: 'Unnamed vehicle', tier: 'free', active: true });
    // the rest sorted by name: Anchor before Zephyr
    expect(rows.map((r) => r.id)).toEqual(['v3', 'v2', 'v1']);
    expect(rows.find((r) => r.id === 'v2')!.tier).toBe('premium');
    expect(rows.every((r) => r.id === 'v3' ? r.active : !r.active)).toBe(true);
  });
});
