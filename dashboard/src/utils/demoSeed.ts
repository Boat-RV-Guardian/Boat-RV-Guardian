// DEMO startup: install the fake demo vehicle (demoFleet.ts) into the app's normal vehicle storage
// and make it active, so the app drops straight into a populated boat with no auth and no onboarding.
// Idempotent — safe to call on every mount.

import { getVehiclesMap, saveVehiclesMap, getActiveVehicleId } from './VehicleManager';
import { VEHICLE_KEYS, VEHICLE_DEFAULT_CONFIG } from './configSync';
import { DEMO_VEHICLE_ID, demoVehicleConfig } from './demoFleet';

/** Seed + activate the demo vehicle in localStorage. No-ops if it's already the active vehicle. */
export function seedDemoVehicle(): void {
  if (getActiveVehicleId() === DEMO_VEHICLE_ID && getVehiclesMap()[DEMO_VEHICLE_ID]) return;

  const config = demoVehicleConfig();
  const map = getVehiclesMap();
  map[DEMO_VEHICLE_ID] = { id: DEMO_VEHICLE_ID, config };
  saveVehiclesMap(map);
  localStorage.setItem('lt_active_vehicle_id', DEMO_VEHICLE_ID);

  // Mirror the vehicle config into the root keys the widgets read (lt_devices, tier, thresholds, …),
  // exactly as switchVehicle() does when you change vehicles.
  for (const key of VEHICLE_KEYS) {
    localStorage.setItem(key, config[key] ?? VEHICLE_DEFAULT_CONFIG[key]);
  }
}
