import { describe, it, expect } from 'vitest';
import {
  DEMO_DEVICES,
  DEMO_SENSOR_SPECS,
  demoSpecFor,
  demoVehicleConfig,
  DEMO_GATEWAY_ID,
  DEMO_TAPLINKER_ID,
} from './demoFleet';
import { VEHICLE_KEYS } from './configSync';
import type { DeviceConfig } from './VehicleManager';

describe('demo fleet', () => {
  it('has one valve plus a set of Shelly sensors, all with unique ids', () => {
    const ids = DEMO_DEVICES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DEMO_DEVICES.filter((d) => d.type === 'linktap_valve')).toHaveLength(1);
    expect(DEMO_DEVICES.filter((d) => d.type === 'shelly_sensor').length).toBeGreaterThan(0);
  });

  it('backs every Shelly device with exactly one telemetry spec', () => {
    const shelly = DEMO_DEVICES.filter((d) => d.type === 'shelly_sensor');
    for (const d of shelly) {
      const spec = demoSpecFor(d.shellyDeviceId!);
      expect(spec, `spec for ${d.shellyDeviceId}`).toBeDefined();
    }
    // and no orphan specs
    const shellyIds = new Set(shelly.map((d) => d.shellyDeviceId));
    for (const s of DEMO_SENSOR_SPECS) expect(shellyIds.has(s.deviceId)).toBe(true);
  });

  it('covers every dashboard category so no section of the demo is empty', () => {
    const roles = new Set(DEMO_DEVICES.map((d) => d.role));
    for (const role of ['Fresh Water', 'High Power Sensor', 'Low Power Sensor', 'Flood Sensor', 'Environmental Sensor']) {
      expect(roles.has(role), role).toBe(true);
    }
  });

  it('demoSpecFor misses cleanly for a non-demo device', () => {
    expect(demoSpecFor('some-real-device')).toBeUndefined();
  });

  it('builds a Premium vehicle config with the fleet installed and every default key present', () => {
    const cfg = demoVehicleConfig();
    expect(cfg.tier).toBe('premium');
    expect(cfg.lt_gateway_id).toBe(DEMO_GATEWAY_ID);
    expect(cfg.lt_device_id).toBe(DEMO_TAPLINKER_ID);
    for (const k of VEHICLE_KEYS) expect(cfg[k], `default key ${k}`).toBeDefined();

    const devices = JSON.parse(cfg.lt_devices) as DeviceConfig[];
    expect(devices).toEqual(DEMO_DEVICES);
  });
});
