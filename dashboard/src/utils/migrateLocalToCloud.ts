// "Migrate local account to the cloud" (Task 15 — the migrate path).
//
// THE HAZARD this module exists to navigate: signing in to a cloud account from local mode triggers
// `applyUserScope` (utils/userScope.ts) to WIPE every `lt_*`/`sh_*` key the instant the new identity is
// observed, and the caller (App.tsx `onAuthStateChanged`) hard-reloads the page right after so no
// stale in-memory state from the local session survives. That wipe is automatic, synchronous with
// sign-in, and happens BEFORE any in-app code gets a chance to read `lt_vehicles` again. So the local
// vehicles MUST be snapshotted into a stash *before* sign-in is triggered, under a storage key
// `clearUserScopedData` will never touch (it only removes keys prefixed `lt_`/`sh_` — this key is
// deliberately namespaced outside that prefix).
//
// After the forced reload, the app boots up signed in to the (new) cloud account. The caller (see
// SyncModal.tsx) checks for this stash and uploads each vehicle through the SAME pipeline used for a
// brand-new vehicle (`updateVehicleConfig` + `ensureOwnerAdmin`). A vehicle is removed from the stash
// ONLY once its cloud write is confirmed to have succeeded — the stash is the only remaining copy of
// the user's local data once the wipe has run, so we never clear it (or treat the migration as "done")
// until the upload is actually confirmed. This mirrors the account-deletion philosophy documented in
// CLAUDE.md ("Auth deleted LAST, only if data cleanup fully succeeded; else abort and stay signed in to
// retry") — don't destroy the only copy before the replacement copy is safely written.

import type { Vehicle } from './VehicleManager';
import type { KeyValueStore } from './userScope';

/** Storage key for the pending-migration snapshot. Deliberately OUTSIDE the `lt_`/`sh_` namespace so
 *  `clearUserScopedData` (run on the forced sign-in reload) never removes it. */
export const PENDING_MIGRATION_KEY = 'brvg_pending_local_migration';

export interface PendingMigration {
  /** Vehicles still waiting to be uploaded, keyed by id (same shape as VehicleManager's map). Vehicles
   *  are removed one at a time as their upload is confirmed — what remains is what's still pending. */
  vehicles: Record<string, Vehicle>;
  /** When the migration was staged (epoch ms). Informational only. */
  startedAt: number;
}

/**
 * Snapshot the given local vehicles map into the pending-migration stash, ready to survive the
 * sign-in wipe+reload. A no-op (and clears any stale stash) when there are no local vehicles — there
 * is nothing to migrate.
 */
export function stashPendingMigration(
  vehiclesMap: Record<string, Vehicle>,
  storage: KeyValueStore,
  now: number = Date.now(),
): void {
  if (Object.keys(vehiclesMap).length === 0) {
    storage.removeItem(PENDING_MIGRATION_KEY);
    return;
  }
  const snapshot: PendingMigration = { vehicles: vehiclesMap, startedAt: now };
  storage.setItem(PENDING_MIGRATION_KEY, JSON.stringify(snapshot));
}

/** Read the pending-migration stash. Tolerates missing/corrupt/malformed JSON by returning null. */
export function readPendingMigration(storage: KeyValueStore): PendingMigration | null {
  const raw = storage.getItem(PENDING_MIGRATION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.vehicles !== 'object' || parsed.vehicles === null) {
      return null;
    }
    return {
      vehicles: parsed.vehicles as Record<string, Vehicle>,
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0,
    };
  } catch {
    return null;
  }
}

/** True iff there's a non-empty migration waiting to be uploaded. */
export function hasPendingMigration(storage: KeyValueStore): boolean {
  const m = readPendingMigration(storage);
  return !!m && Object.keys(m.vehicles).length > 0;
}

/**
 * Remove a single vehicle from the stash — call ONLY once its cloud upload is confirmed to have
 * succeeded. Clears the stash key entirely once no vehicles remain. A no-op if the stash or the
 * vehicle id is already gone (idempotent / safe to call from a retry).
 */
export function markMigrated(vid: string, storage: KeyValueStore): void {
  const m = readPendingMigration(storage);
  if (!m || !(vid in m.vehicles)) return;
  const rest = { ...m.vehicles };
  delete rest[vid];
  if (Object.keys(rest).length === 0) {
    storage.removeItem(PENDING_MIGRATION_KEY);
  } else {
    storage.setItem(PENDING_MIGRATION_KEY, JSON.stringify({ vehicles: rest, startedAt: m.startedAt }));
  }
}

/** Discard the stash entirely — e.g. the user backs out of the flow before sign-in completes. */
export function clearPendingMigration(storage: KeyValueStore): void {
  storage.removeItem(PENDING_MIGRATION_KEY);
}
