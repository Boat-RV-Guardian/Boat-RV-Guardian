// Pure helpers for the Account & Plan portal (open-tasks Task 14): trial status, a human-readable
// telemetry cadence, and the "usage vs plan" rows. No I/O so they're trivially testable; Account.tsx
// feeds them the active vehicle's trial expiry + entitlements + local device/vehicle counts.

import type { Entitlements, EntitlementLine, Tier } from './entitlements';
import { formatRetention, getVehicleTier } from './entitlements';

export type TrialState = 'none' | 'active' | 'expired';

export interface TrialStatus {
  state: TrialState;
  /** Whole days remaining (ceil), 0 unless active. */
  daysLeft: number;
}

/**
 * Resolve a vehicle's Basic-trial status from its `trialEndsAt` (epoch ms) as of `nowMs`. A missing /
 * non-positive / non-finite marker means no trial is in play. The daily worker cron lapses an expired
 * trial back to `free`, but the UI can show "expired" in the gap before the next sweep.
 */
export function trialStatus(trialEndsAtMs: number | null | undefined, nowMs: number): TrialStatus {
  if (trialEndsAtMs == null || !Number.isFinite(trialEndsAtMs) || trialEndsAtMs <= 0) {
    return { state: 'none', daysLeft: 0 };
  }
  if (nowMs > trialEndsAtMs) return { state: 'expired', daysLeft: 0 };
  return { state: 'active', daysLeft: Math.ceil((trialEndsAtMs - nowMs) / 86_400_000) };
}

/** Human-readable telemetry persistence cadence, e.g. 60→"Every minute", 1800→"Every 30 minutes". */
export function formatTelemetryResolution(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  if (sec < 60) return `Every ${sec}s`;
  const mins = Math.round(sec / 60);
  if (mins < 60) return mins === 1 ? 'Every minute' : `Every ${mins} minutes`;
  const hrs = Math.round(mins / 60);
  return hrs === 1 ? 'Every hour' : `Every ${hrs} hours`;
}

/**
 * "Usage vs plan" rows for the Account portal: what the active plan grants for the data axes plus the
 * current device/vehicle counts. `on` drives the check/○ styling, mirroring entitlementSummary.
 */
export function usageRows(
  ent: Entitlements,
  counts: { vehicleCount: number; deviceCount: number },
): EntitlementLine[] {
  return [
    { label: 'Telemetry resolution', value: formatTelemetryResolution(ent.telemetryResolutionSec), on: true },
    { label: 'Hosted history', value: formatRetention(ent.historyRetentionDays), on: ent.historyRetentionDays > 0 },
    { label: 'Devices on this vehicle', value: String(counts.deviceCount), on: counts.deviceCount > 0 },
    { label: 'Vehicles', value: String(counts.vehicleCount), on: counts.vehicleCount > 0 },
  ];
}

export interface VehiclePlanRow {
  id: string;
  name: string;
  /** Resolved (grandfathered) per-vehicle tier. */
  tier: Tier;
  active: boolean;
}

/**
 * Per-vehicle plan rows for the Account portal (Task 14 "per-vehicle assignment" — billing is
 * per-vehicle / "Plex"). Resolves each local vehicle's synced `tier` through getVehicleTier (so an
 * unset/legacy vehicle grandfathers consistently with the rest of the app), marks the active one,
 * and sorts it first. Pure — Account.tsx feeds it the local `lt_vehicles` map + `lt_active_vehicle_id`.
 */
export function vehiclePlanRows(
  vehiclesMap: Record<string, { config?: Record<string, string> } | undefined>,
  activeVid: string | null,
): VehiclePlanRow[] {
  return Object.entries(vehiclesMap)
    .map(([id, v]) => ({
      id,
      name: (v?.config?.lt_vessel_name || '').trim() || 'Unnamed vehicle',
      tier: getVehicleTier({ tier: v?.config?.tier }),
      active: id === activeVid,
    }))
    .sort((a, b) => (a.active === b.active ? a.name.localeCompare(b.name) : a.active ? -1 : 1));
}
