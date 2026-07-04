// The fake fleet DEMO mode drops the visitor straight into: one boat with a LinkTap valve and a set of
// Shelly sensors, each backed by a deterministic generator in demoTelemetry.ts. This module is the
// single source of truth for the demo's devices — their DeviceConfig (what the app's device list /
// widgets read) alongside the DemoSensorSpec that feeds each one's telemetry.
//
// Pure data + builders only; nothing here touches storage, auth, or the poll paths. Wiring the specs
// into the widget seams (and seeding this vehicle at startup) is a later increment.

import type { DeviceConfig } from './VehicleManager';
import { VEHICLE_DEFAULT_CONFIG } from './configSync';
import type { DemoSensorSpec } from './demoTelemetry';

export const DEMO_VEHICLE_ID = 'demo-vehicle';
export const DEMO_GATEWAY_ID = 'demo-gateway';
export const DEMO_TAPLINKER_ID = 'demo-taplinker';

/** The demo boat's devices, in the shape the app's device list + widgets already expect. */
export const DEMO_DEVICES: DeviceConfig[] = [
  {
    id: 'demo-valve',
    type: 'linktap_valve',
    role: 'Fresh Water',
    name: 'Fresh Water Fill',
    linktapGatewayId: DEMO_GATEWAY_ID,
    linktapDeviceId: DEMO_TAPLINKER_ID,
  },
  {
    id: 'demo-shore',
    type: 'shelly_sensor',
    role: 'High Power Sensor',
    name: 'Shore Power',
    shellyDeviceId: 'demo-shore',
  },
  {
    id: 'demo-house-batt',
    type: 'shelly_sensor',
    role: 'Low Power Sensor',
    name: 'House Battery',
    shellyDeviceId: 'demo-house-batt',
  },
  {
    id: 'demo-engine-batt',
    type: 'shelly_sensor',
    role: 'Low Power Sensor',
    name: 'Engine Battery',
    shellyDeviceId: 'demo-engine-batt',
  },
  {
    id: 'demo-flood',
    type: 'shelly_sensor',
    role: 'Flood Sensor',
    name: 'Bilge Flood Sensor',
    shellyDeviceId: 'demo-flood',
    batteryPowered: true,
  },
];

/** Telemetry generator spec per Shelly device id (the LinkTap valve is driven by demoLinkTapDoc). */
export const DEMO_SENSOR_SPECS: DemoSensorSpec[] = [
  { deviceId: 'demo-shore', kind: 'shore', base: 120 },
  // House bank climbs on solar through the day and also reports cabin temperature (🌡️ badge).
  { deviceId: 'demo-house-batt', kind: 'battery', base: 12.5, solar: true, tempBaseC: 21 },
  { deviceId: 'demo-engine-batt', kind: 'battery', base: 12.8 },
  { deviceId: 'demo-flood', kind: 'flood', base: 0 },
];

/** Look up the generator spec for a Shelly device id, if this is a demo device. */
export function demoSpecFor(deviceId: string): DemoSensorSpec | undefined {
  return DEMO_SENSOR_SPECS.find((s) => s.deviceId === deviceId);
}

/**
 * The demo vehicle's config record — real defaults, with the demo fleet installed, a Premium tier so
 * every feature is visible in the showcase, and the LinkTap gateway/valve ids wired to the generators.
 */
export function demoVehicleConfig(): Record<string, string> {
  return {
    ...VEHICLE_DEFAULT_CONFIG,
    lt_vessel_name: 'Serenity (Demo)',
    lt_vehicle_type: 'boat',
    tier: 'premium',
    lt_gateway_id: DEMO_GATEWAY_ID,
    lt_device_id: DEMO_TAPLINKER_ID,
    lt_devices: JSON.stringify(DEMO_DEVICES),
  };
}
