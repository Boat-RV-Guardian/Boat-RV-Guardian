// One-tap "Open valve now" cap resolution. The LinkTap valve NEVER opens without a duration + volume
// limit (the real safety net — see the safety model in CLAUDE.md); this only decides WHICH bounded cap
// the quick-open button uses. There is deliberately no code path here that yields an unbounded open.

import type { DeviceConfig } from './VehicleManager';

export const DEFAULT_QUICK_OPEN_MINS = 30;
export const DEFAULT_QUICK_OPEN_VOLUME_L = 100;

/** Round to a whole number ≥ 1, falling back to `dflt` for 0 / blank / NaN — so a cap is never 0. */
function positive(v: number | undefined, dflt: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 ? n : dflt;
}

/**
 * Resolve the { durationMins, volumeLiters } cap for a one-tap open.
 * - `applyDefaultCap !== false` (the default): use the per-valve default cap
 *   (`defaultCapMins` / `defaultCapVolumeL`, falling back to 30 min / 100 L).
 * - `applyDefaultCap === false`: use the Normal Run Profile limit passed in (still bounded).
 * Both channels are floored to a positive value, so a zero/blank config can never mean "open forever".
 */
export function resolveQuickOpenCap(
  device: DeviceConfig,
  normalRun: { durationMins: number; volumeLiters: number },
): { durationMins: number; volumeLiters: number } {
  const useDefault = device.applyDefaultCap !== false;
  const mins = useDefault ? device.defaultCapMins : normalRun.durationMins;
  const vol = useDefault ? device.defaultCapVolumeL : normalRun.volumeLiters;
  return {
    durationMins: positive(mins, DEFAULT_QUICK_OPEN_MINS),
    volumeLiters: positive(vol, DEFAULT_QUICK_OPEN_VOLUME_L),
  };
}
