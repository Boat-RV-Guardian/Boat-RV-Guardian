// Per-user local-data ownership (data-isolation fix, 2026-06-28).
//
// The cloud (Firebase login) is the source of truth for a user's vehicles; local storage is only an
// OFFLINE CACHE of the currently-signed-in user's data. To stop one account's data (vehicles AND
// their secrets — LinkTap cloud creds, Shelly local passwords, self-host keys) from bleeding into a
// different account on the same device, we stamp localStorage with the owning `uid` and wipe all
// user-scoped keys whenever the signed-in identity changes (login as someone else, or sign-out).
//
// Crucially this is a NO-OP when the same user is restored (e.g. an offline relaunch where Firebase
// rehydrates the persisted session) — so the offline cache survives for the user it belongs to.

import { LOCAL_ONLY_KEYS } from './configSync';

/** localStorage key holding the uid that the currently-cached data belongs to ('' / absent = none). */
export const DATA_OWNER_KEY = 'lt_data_owner_uid';

// Keys NOT cleared on a user change: device-local preferences (timezone, units, notification toggles,
// polling flags — see LOCAL_ONLY_KEYS) plus the ownership stamp itself. Everything else under the
// `lt_`/`sh_` namespaces is per-user/per-vehicle (config, secrets, vehicle map, role/tier stashes,
// per-device history/event logs) and is wiped.
const KEEP_KEYS = new Set<string>([...LOCAL_ONLY_KEYS, DATA_OWNER_KEY]);

/** Minimal storage surface we depend on — lets tests pass a shim without a full Storage. */
export interface KeyValueStore {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Remove every user-scoped key (`lt_*` / `sh_*`) except the device-local prefs and the ownership
 * stamp. Returns the removed keys (handy for logging/tests). Pure aside from the storage mutation.
 */
export function clearUserScopedData(storage: KeyValueStore): string[] {
  // Snapshot keys first — removing while iterating by index reshuffles the store.
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k) keys.push(k);
  }
  const removed: string[] = [];
  for (const k of keys) {
    if ((k.startsWith('lt_') || k.startsWith('sh_')) && !KEEP_KEYS.has(k)) {
      storage.removeItem(k);
      removed.push(k);
    }
  }
  return removed;
}

/** True for a local-only (no-account) owner stamp. Local sessions never touch the cloud. */
export function isLocalOwner(owner: string | null | undefined): boolean {
  return !!owner && owner.startsWith('local:');
}

/** Is the device currently in local-only mode (no cloud account)? */
export function isLocalMode(storage: KeyValueStore): boolean {
  return isLocalOwner(storage.getItem(DATA_OWNER_KEY));
}

/**
 * Enter local-only mode: stamp a synthetic `local:<rand>` owner so the per-user cache isolates this
 * session (and survives relaunches) WITHOUT any Firebase account. Nothing syncs to the cloud in this
 * mode — the cloud code paths all require a signed-in Firebase user, of which there is none.
 * `rand` varies the id; collisions are irrelevant (single device, single local session).
 */
export function enterLocalMode(rand: string, storage: KeyValueStore): string {
  const id = 'local:' + rand;
  storage.setItem(DATA_OWNER_KEY, id);
  return id;
}

/** Leave local-only mode (e.g. to switch to a cloud account): drop the local session + its data. */
export function exitLocalMode(storage: KeyValueStore): void {
  if (isLocalMode(storage)) {
    clearUserScopedData(storage);
    storage.removeItem(DATA_OWNER_KEY);
  }
}

export interface UserScopeResult {
  /** True when cached data from a DIFFERENT prior owner was wiped (caller should reset app state). */
  wiped: boolean;
}

/**
 * Reconcile the local cache with the signed-in identity. Pass the current Firebase uid (or null when
 * signed out). If it differs from the stamped owner, all user-scoped keys are cleared and the stamp is
 * updated. `wiped` is true ONLY when there was a prior, different owner whose data we just discarded
 * (login-as-different-user or sign-out) — the first sign-in on a clean device returns `wiped:false`
 * (nothing stale to clear, and no reload needed). Same-uid restore is a complete no-op.
 */
export function applyUserScope(uid: string | null, storage: KeyValueStore): UserScopeResult {
  const prev = storage.getItem(DATA_OWNER_KEY) || '';
  const cur = uid || '';
  if (prev === cur) return { wiped: false };

  // A local-only session has no Firebase user, so onAuthStateChanged fires null on every launch — that
  // must NOT wipe it. Only a real cloud sign-in (cur is a non-local uid) ends a local session.
  if (isLocalOwner(prev) && cur === '') return { wiped: false };

  const hadDifferentOwner = prev !== '';
  clearUserScopedData(storage);
  if (cur) storage.setItem(DATA_OWNER_KEY, cur);
  else storage.removeItem(DATA_OWNER_KEY);
  return { wiped: hadDifferentOwner };
}
