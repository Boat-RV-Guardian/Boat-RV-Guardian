// Safety cap for an EXTERNALLY-started valve open (someone pressed the physical button on the valve,
// or opened it from the LinkTap app). When our app detects such a run with no known limit, it applies
// this max-volume cap so a manual open can't run unbounded — the software volume-cutoff then closes
// the valve at the cap. Per the safety model (CLAUDE.md), the valve never runs without a limit.

import type { DeviceConfig } from './VehicleManager';

/** Default max-volume cap (liters) for externally-started opens when the valve has none configured. */
export const DEFAULT_EXTERNAL_CAP_L = 100;

/**
 * The max-volume cap (in liters) to enforce on an externally-started open for this valve.
 * Uses the per-valve `defaultCapVolumeL`, falling back to DEFAULT_EXTERNAL_CAP_L. Always returns a
 * positive value — there is no "uncapped" result.
 */
export function externalOpenCapLiters(device: DeviceConfig): number {
  const v = Math.round(Number(device.defaultCapVolumeL));
  return Number.isFinite(v) && v >= 1 ? v : DEFAULT_EXTERNAL_CAP_L;
}
