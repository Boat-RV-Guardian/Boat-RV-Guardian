import { describe, it, expect } from 'vitest';
import { trialStatus, formatTelemetryResolution, usageRows } from './accountSummary';
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
