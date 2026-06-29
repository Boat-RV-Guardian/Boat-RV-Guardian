import { describe, it, expect, beforeEach } from 'vitest';
import {
  migrateFlatThresholds,
  migrateAllVehiclesThresholds,
  isLocalProfileFresh,
  isLocalVehicleConfigDefault,
  getLocalVehicleConfig,
  applyCloudVehicleConfig,
  cloudConfigDiffers,
  VEHICLE_DEFAULT_CONFIG,
} from './configSync';

beforeEach(() => localStorage.clear());

describe('migrateFlatThresholds (value-matched, idempotent)', () => {
  it('upgrades only keys still equal to the OLD default', () => {
    localStorage.setItem('lt_batt_low_v', '11.9'); // old default → should upgrade
    localStorage.setItem('lt_shore_low_v', '100'); // old default → should upgrade
    const changed = migrateFlatThresholds();

    expect(changed).toBe(true);
    expect(localStorage.getItem('lt_batt_low_v')).toBe('12.2');
    expect(localStorage.getItem('lt_shore_low_v')).toBe('114');
  });

  it('leaves user-customized values untouched', () => {
    localStorage.setItem('lt_batt_low_v', '12.0'); // not the old default → a deliberate choice
    const changed = migrateFlatThresholds();

    expect(changed).toBe(false);
    expect(localStorage.getItem('lt_batt_low_v')).toBe('12.0');
  });

  it('is idempotent — a second run changes nothing', () => {
    localStorage.setItem('lt_batt_low_v', '11.9');
    expect(migrateFlatThresholds()).toBe(true);
    expect(migrateFlatThresholds()).toBe(false);
  });
});

describe('migrateAllVehiclesThresholds (flag-gated map sweep)', () => {
  it('migrates non-active vehicles stored in lt_vehicles and sets the done flag', () => {
    localStorage.setItem('lt_vehicles', JSON.stringify({
      v1: { config: { lt_shore_crit_low_v: '95' } }, // old default
      v2: { config: { lt_shore_crit_low_v: '110' } }, // customized
    }));

    migrateAllVehiclesThresholds();

    const map = JSON.parse(localStorage.getItem('lt_vehicles')!);
    expect(map.v1.config.lt_shore_crit_low_v).toBe('104'); // upgraded
    expect(map.v2.config.lt_shore_crit_low_v).toBe('110'); // preserved
    expect(localStorage.getItem('lt_thresholds_migrated_v2')).toBe('true');
  });

  it('no-ops once the migrated flag is set', () => {
    localStorage.setItem('lt_thresholds_migrated_v2', 'true');
    localStorage.setItem('lt_vehicles', JSON.stringify({ v1: { config: { lt_shore_crit_low_v: '95' } } }));

    migrateAllVehiclesThresholds();

    const map = JSON.parse(localStorage.getItem('lt_vehicles')!);
    expect(map.v1.config.lt_shore_crit_low_v).toBe('95'); // untouched because flag short-circuits
  });
});

describe('profile freshness checks', () => {
  it('a brand-new profile is fresh even with the auto-named vessel + auto password', () => {
    localStorage.setItem('lt_vessel_name', 'My First Vessel'); // auto-named, must not count
    localStorage.setItem('sh_local_password', 'auto-generated'); // auto-gen, must not count
    expect(isLocalProfileFresh()).toBe(true);
  });

  it('any real config value makes the profile non-fresh', () => {
    localStorage.setItem('lt_cloud_user', 'skipper@example.com');
    expect(isLocalProfileFresh()).toBe(false);
  });

  it('isLocalVehicleConfigDefault is false once a vessel is renamed', () => {
    localStorage.setItem('lt_vessel_name', 'Serenity');
    expect(isLocalVehicleConfigDefault()).toBe(false);
  });
});

describe('getLocalVehicleConfig / applyCloudVehicleConfig round-trip', () => {
  it('getLocalVehicleConfig fills unset keys with their defaults', () => {
    const cfg = getLocalVehicleConfig();
    expect(cfg.lt_maxflow).toBe(VEHICLE_DEFAULT_CONFIG.lt_maxflow);
    expect(Object.keys(cfg).length).toBe(Object.keys(VEHICLE_DEFAULT_CONFIG).length);
  });

  it('applyCloudVehicleConfig writes provided values and defaults the rest', () => {
    applyCloudVehicleConfig({ lt_vessel_name: 'Wanderer', lt_maxflow: '20' });
    expect(localStorage.getItem('lt_vessel_name')).toBe('Wanderer');
    expect(localStorage.getItem('lt_maxflow')).toBe('20');
    // a key not in the cloud payload falls back to its default
    expect(localStorage.getItem('lt_auto_guard')).toBe(VEHICLE_DEFAULT_CONFIG.lt_auto_guard);
  });

  it('applyCloudVehicleConfig migrates OLD-default thresholds pulled from the cloud', () => {
    applyCloudVehicleConfig({ lt_batt_crit_v: '11.5' }); // old default arriving from cloud
    expect(localStorage.getItem('lt_batt_crit_v')).toBe('11.8'); // corrected to new standard
  });
});

describe('cloudConfigDiffers (cloud-wins comparison)', () => {
  it('returns false when every cloud-seen key matches', () => {
    expect(cloudConfigDiffers({ a: '1', b: '2' }, { a: '1', b: '2' })).toBe(false);
  });

  it('returns true when a shared key differs', () => {
    expect(cloudConfigDiffers({ a: '1', b: '2' }, { a: '1', b: '9' })).toBe(true);
  });

  it('ignores keys the cloud has not seen yet (newly added fields)', () => {
    // `b` is absent from the cloud doc — a new field, not a divergence.
    expect(cloudConfigDiffers({ a: '1', b: '2' }, { a: '1' })).toBe(false);
  });

  it('treats a differing value on a cloud-seen key as a divergence even with new local keys', () => {
    expect(cloudConfigDiffers({ a: '1', b: '2' }, { a: '9' })).toBe(true);
  });
});
