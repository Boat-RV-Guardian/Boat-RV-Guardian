import { describe, it, expect } from 'vitest';
import { externalOpenCapLiters, DEFAULT_EXTERNAL_CAP_L } from './quickOpen';
import type { DeviceConfig } from './VehicleManager';

const valve = (o: Partial<DeviceConfig> = {}): DeviceConfig =>
  ({ id: 'v', type: 'linktap_valve', role: 'Fresh Water', name: 'V', ...o });

describe('externalOpenCapLiters', () => {
  it('uses the per-valve configured cap', () => {
    expect(externalOpenCapLiters(valve({ defaultCapVolumeL: 60 }))).toBe(60);
  });

  it('falls back to the default when unset', () => {
    expect(externalOpenCapLiters(valve())).toBe(DEFAULT_EXTERNAL_CAP_L);
  });

  it('NEVER returns 0 / negative / NaN (no unbounded external open)', () => {
    expect(externalOpenCapLiters(valve({ defaultCapVolumeL: 0 }))).toBe(DEFAULT_EXTERNAL_CAP_L);
    expect(externalOpenCapLiters(valve({ defaultCapVolumeL: -5 }))).toBe(DEFAULT_EXTERNAL_CAP_L);
    expect(externalOpenCapLiters(valve({ defaultCapVolumeL: NaN }))).toBe(DEFAULT_EXTERNAL_CAP_L);
  });

  it('rounds fractional liters', () => {
    expect(externalOpenCapLiters(valve({ defaultCapVolumeL: 49.6 }))).toBe(50);
  });
});
