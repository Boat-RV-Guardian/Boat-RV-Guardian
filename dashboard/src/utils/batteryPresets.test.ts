import { describe, it, expect } from 'vitest';
import { BATTERY_PRESETS, getBatteryThresholds } from './batteryPresets';

describe('getBatteryThresholds', () => {
  it('returns the 12 V preset for a known chemistry', () => {
    expect(getBatteryThresholds('flooded', '12')).toEqual({
      crit: 11.8, low: 12.2, normal: 12.6, charge: 13.6, over: 15.0,
    });
  });

  it('returns the 24 V preset for a known chemistry', () => {
    expect(getBatteryThresholds('lifepo4', '24')).toEqual({
      crit: 24.0, low: 25.6, normal: 26.4, charge: 27.6, over: 29.2,
    });
  });

  it('returns null for the custom chemistry (leave manual values untouched)', () => {
    expect(getBatteryThresholds('custom', '12')).toBeNull();
  });

  it('returns null for an unknown chemistry', () => {
    expect(getBatteryThresholds('nonesuch', '12')).toBeNull();
  });

  it('returns null for an unknown system voltage', () => {
    expect(getBatteryThresholds('agm', '48')).toBeNull();
  });

  it('exposes a label for every preset for the dropdown', () => {
    for (const key of Object.keys(BATTERY_PRESETS)) {
      expect(typeof BATTERY_PRESETS[key].label).toBe('string');
      expect(BATTERY_PRESETS[key].label.length).toBeGreaterThan(0);
    }
  });
});
