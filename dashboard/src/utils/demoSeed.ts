// DEMO startup: install the fake demo vehicle (demoFleet.ts) into the app's normal vehicle storage
// and make it active, so the app drops straight into a populated boat with no auth and no onboarding.
// Idempotent — safe to call on every mount.

import { getVehiclesMap, saveVehiclesMap, getActiveVehicleId } from './VehicleManager';
import { VEHICLE_KEYS, VEHICLE_DEFAULT_CONFIG } from './configSync';
import { DEMO_VEHICLE_ID, demoVehicleConfig, DEMO_SENSOR_SPECS } from './demoFleet';
import { demoVoltage } from './demoTelemetry';
import { LOCATION_KEY, type VehicleLocation } from './vehicleLocation';

const MIN = 60_000;

/** Seed + activate the demo vehicle in localStorage. No-ops if it's already the active vehicle. */
export function seedDemoVehicle(now = Date.now()): void {
  if (getActiveVehicleId() === DEMO_VEHICLE_ID && getVehiclesMap()[DEMO_VEHICLE_ID]) return;

  const config = { ...demoVehicleConfig() };
  // Pin the demo boat on a scenic lake so the dashboard's Location map is populated immediately.
  const loc: VehicleLocation = { lat: 39.0968, lon: -120.0324, acc: 18, ts: now - 12 * MIN, src: 'device' };
  config[LOCATION_KEY] = JSON.stringify(loc);

  const map = getVehiclesMap();
  map[DEMO_VEHICLE_ID] = { id: DEMO_VEHICLE_ID, config };
  saveVehiclesMap(map);
  localStorage.setItem('lt_active_vehicle_id', DEMO_VEHICLE_ID);

  // Mirror the vehicle config into the root keys the widgets read (lt_devices, tier, thresholds, …),
  // exactly as switchVehicle() does when you change vehicles.
  for (const key of VEHICLE_KEYS) {
    localStorage.setItem(key, config[key] ?? VEHICLE_DEFAULT_CONFIG[key]);
  }

  seedDemoReadingHistory(now);
}

// Pre-populate the dashboard sparklines so a first-time visitor sees trend lines instantly instead of
// waiting for live ticks. Only the voltage sensors (shore/battery) are seeded — their display value is
// the raw volts the generator produces, so a seeded point matches a live-recorded one exactly.
// Climate/flood fill in live. Written directly in the readingHistory `{t,v}[]` shape (see readingHistory.ts).
function seedDemoReadingHistory(now: number): void {
  const POINTS = 30, STEP = 20 * MIN; // ~10 h of history
  // Each seeded point is the MEAN of sub-samples spread over exactly ONE period of the generator's
  // fast ripple, not a single instantaneous read. Sampling a 12-min ripple every 20 min aliases into
  // a hard sawtooth; averaging over a whole period cancels it and leaves the real trend (the solar
  // climb, the shore swell) — which is also what a 20-minute bucket of real readings would show.
  const SUBS = 12;
  const rippleMs = (kind: string) => (kind === 'shore' ? 8 * MIN : 12 * MIN); // see demoVoltage()
  for (const spec of DEMO_SENSOR_SPECS) {
    if (spec.kind !== 'shore' && spec.kind !== 'battery') continue;
    const key = `lt_read_hist_${spec.deviceId}`;
    if (localStorage.getItem(key)) continue; // don't clobber an existing session's points
    const win = rippleMs(spec.kind);
    const pts = [];
    for (let i = POINTS - 1; i >= 0; i--) {
      const t = now - i * STEP;
      let sum = 0;
      for (let s = 0; s < SUBS; s++) sum += demoVoltage(spec, t - (s * win) / SUBS);
      pts.push({ t, v: Math.round((sum / SUBS) * 100) / 100 });
    }
    localStorage.setItem(key, JSON.stringify(pts));
  }
}
