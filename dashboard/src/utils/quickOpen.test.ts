import { describe, it, expect } from 'vitest';
import { resolveQuickOpenCap, DEFAULT_QUICK_OPEN_MINS, DEFAULT_QUICK_OPEN_VOLUME_L } from './quickOpen';
import type { DeviceConfig } from './VehicleManager';

const valve = (o: Partial<DeviceConfig> = {}): DeviceConfig =>
  ({ id: 'v', type: 'linktap_valve', role: 'Fresh Water', name: 'V', ...o });
const normal = { durationMins: 120, volumeLiters: 300 };

describe('resolveQuickOpenCap', () => {
  it('uses the per-valve default cap by default (applyDefaultCap undefined = on)', () => {
    expect(resolveQuickOpenCap(valve({ defaultCapMins: 20, defaultCapVolumeL: 60 }), normal))
      .toEqual({ durationMins: 20, volumeLiters: 60 });
  });

  it('falls back to 30 min / 100 L when the default cap is unset', () => {
    expect(resolveQuickOpenCap(valve({ applyDefaultCap: true }), normal))
      .toEqual({ durationMins: DEFAULT_QUICK_OPEN_MINS, volumeLiters: DEFAULT_QUICK_OPEN_VOLUME_L });
  });

  it('uses the Normal Run Profile limit when applyDefaultCap is false', () => {
    expect(resolveQuickOpenCap(valve({ applyDefaultCap: false, defaultCapMins: 20, defaultCapVolumeL: 60 }), normal))
      .toEqual({ durationMins: 120, volumeLiters: 300 });
  });

  it('NEVER yields an uncapped open — 0 / blank / negative floors to the default', () => {
    // default channel with 0s
    expect(resolveQuickOpenCap(valve({ defaultCapMins: 0, defaultCapVolumeL: 0 }), normal))
      .toEqual({ durationMins: DEFAULT_QUICK_OPEN_MINS, volumeLiters: DEFAULT_QUICK_OPEN_VOLUME_L });
    // normal-run channel with 0s (e.g. no profile set)
    expect(resolveQuickOpenCap(valve({ applyDefaultCap: false }), { durationMins: 0, volumeLiters: 0 }))
      .toEqual({ durationMins: DEFAULT_QUICK_OPEN_MINS, volumeLiters: DEFAULT_QUICK_OPEN_VOLUME_L });
    // negative / NaN
    const r = resolveQuickOpenCap(valve({ defaultCapMins: -5, defaultCapVolumeL: NaN }), normal);
    expect(r.durationMins).toBeGreaterThanOrEqual(1);
    expect(r.volumeLiters).toBeGreaterThanOrEqual(1);
  });

  it('rounds fractional values to whole units', () => {
    expect(resolveQuickOpenCap(valve({ defaultCapMins: 15.6, defaultCapVolumeL: 49.4 }), normal))
      .toEqual({ durationMins: 16, volumeLiters: 49 });
  });
});
