import { describe, it, expect } from 'vitest';
import {
  normalizeCloudStatus,
  pickTargetVolume,
  pickTargetDuration,
} from './linktapStatus';

describe('normalizeCloudStatus', () => {
  it('folds a watering cloud response into the native shape', () => {
    const cloud = {
      status: {
        isWatering: true,
        vel: 3.2,
        vol: 12,
        limit: 50,
        totalDuration: 30,    // minutes
        onDuration: 10,       // minutes elapsed
      },
    };
    const out = normalizeCloudStatus(cloud, { battery: 80, signal: 60, status: 'Online' });

    expect(out.is_rf_linked).toBe(true);
    expect(out.battery).toBe(80);
    expect(out.signal).toBe(60);
    expect(out.is_watering).toBe(true);
    expect(out.speed).toBe(3.2);
    expect(out.volume).toBe(12);
    expect(out.target_volume).toBe(50);
    expect(out.target_duration).toBe(30);
    expect(out.is_broken).toBe(false);
    // With `total` absent, remain falls to the totalDuration/onDuration branch. Both are minutes, so
    // remaining = (30 - 10) * 60 = 1200s. (Previously this subtracted onDuration as raw seconds →
    // 1790; fixed 2026-06-25.)
    expect(out.remain_duration).toBe(1200);
  });

  it('marks the device offline and defaults battery/signal when uncached', () => {
    const out = normalizeCloudStatus({ status: {} }, { status: 'Offline' });
    expect(out.is_rf_linked).toBe(false);
    expect(out.battery).toBe(100);
    expect(out.signal).toBe(100);
    expect(out.is_watering).toBe(false);
  });

  it('detects watering from a nested watering object and computes remaining', () => {
    const out = normalizeCloudStatus(
      { status: { watering: { vol: 25, duration: 20, remaining: 5 } } },
      {},
    );
    expect(out.is_watering).toBe(true);     // st.watering != null
    expect(out.target_volume).toBe(25);
    expect(out.target_duration).toBe(20);
    expect(out.remain_duration).toBe(300);  // 5 min * 60
  });

  it('tolerates a totally empty payload', () => {
    const out = normalizeCloudStatus(null, {});
    expect(out.is_watering).toBe(false);
    expect(out.speed).toBe(0);
    expect(out.remain_duration).toBe(0);
  });
});

describe('pickTargetVolume / pickTargetDuration', () => {
  it('reads the first present volume field', () => {
    expect(pickTargetVolume({ target_volume: 10 })).toBe(10);
    expect(pickTargetVolume({ limit: 20 })).toBe(20);
    expect(pickTargetVolume({ watering: { vol: 30 } })).toBe(30);
    expect(pickTargetVolume({})).toBe(0);
  });

  it('reads the first present duration field', () => {
    expect(pickTargetDuration({ target_duration: 15 })).toBe(15);
    expect(pickTargetDuration({ totalDuration: 25 })).toBe(25);
    expect(pickTargetDuration({ watering: { duration: 35 } })).toBe(35);
    expect(pickTargetDuration({})).toBe(0);
  });

  it('uses ?? so an explicit 0 target is preserved over later fallbacks', () => {
    // target_volume:0 should win over limit:99 because ?? only falls through on null/undefined.
    expect(pickTargetVolume({ target_volume: 0, limit: 99 })).toBe(0);
  });
});
