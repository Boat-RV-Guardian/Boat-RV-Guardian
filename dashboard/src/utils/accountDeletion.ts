// Account deletion (open-tasks Task 14 — GDPR / Play / App-Store "delete account" requirement).
// The decision logic + orchestration are pure and dependency-injected so they're fully unit-testable
// without Firebase; Account.tsx supplies the real Firestore/Auth operations (lazy-imported in the
// handler so this module — and the page's tests — stay Firebase-free).

export interface VehicleAccess {
  id: string;
  /** uids with access to the vehicle (the vehicle doc's `allowedUsers`). */
  allowedUsers: string[];
  /** The owner uid (vehicle doc `owner`), if known. */
  owner?: string | null;
}

export interface OwnedSharedVehicle {
  id: string;
  /** Other members' uids (everyone with access except the user being deleted) — transfer candidates. */
  others: string[];
}

export interface DeletionClassification {
  /** Vehicles the user solely owns (no other members) → delete the doc. */
  toDelete: string[];
  /** Vehicles the user OWNS that have other members → the user must choose: transfer or delete. */
  ownedShared: OwnedSharedVehicle[];
  /** Vehicles shared with the user that they don't own → just remove them (leave). */
  toLeave: string[];
}

/**
 * Classify the user's vehicles for account deletion, distinguishing owned-and-shared vehicles (which
 * warrant a transfer-or-delete decision) from solo-owned (delete) and not-owned (leave). Ownership is
 * the vehicle's `owner` field; a sole-member vehicle is always a delete regardless of owner. Pure.
 */
export function classifyForDeletion(vehicles: VehicleAccess[], uid: string): DeletionClassification {
  const toDelete: string[] = [];
  const ownedShared: OwnedSharedVehicle[] = [];
  const toLeave: string[] = [];
  for (const v of vehicles) {
    const users = Array.isArray(v.allowedUsers) ? v.allowedUsers : [];
    if (!users.includes(uid)) continue;
    const others = users.filter((u) => u !== uid);
    if (others.length === 0) { toDelete.push(v.id); continue; }   // sole member → delete
    if (v.owner === uid) ownedShared.push({ id: v.id, others: others.sort() }); // I own a shared one → decide
    else toLeave.push(v.id);                                      // shared with me, not owner → leave
  }
  return { toDelete: toDelete.sort(), ownedShared, toLeave: toLeave.sort() };
}

export interface DeletionPlan {
  /** Vehicles the user solely owns → delete the doc entirely. */
  toDelete: string[];
  /** Vehicles shared with others → just remove the user (leave), preserving them for co-owners. */
  toLeave: string[];
}

/**
 * Decide, for each vehicle the user can access, whether deleting their account should DELETE the
 * vehicle (they're its only member) or just remove THEM from it (others still use it). A vehicle the
 * user isn't actually in is ignored. Pure.
 */
export function accountDeletionPlan(vehicles: VehicleAccess[], uid: string): DeletionPlan {
  const toDelete: string[] = [];
  const toLeave: string[] = [];
  for (const v of vehicles) {
    const users = Array.isArray(v.allowedUsers) ? v.allowedUsers : [];
    if (!users.includes(uid)) continue;            // not ours — leave it alone
    if (users.filter((u) => u !== uid).length === 0) toDelete.push(v.id); // sole member → delete
    else toLeave.push(v.id);                        // shared → just leave
  }
  return { toDelete: toDelete.sort(), toLeave: toLeave.sort() };
}

export interface DeletionDeps {
  deleteVehicle: (vid: string) => Promise<void>;
  leaveVehicle: (vid: string, uid: string) => Promise<void>;
  deleteUserDoc: (uid: string) => Promise<void>;
  deleteAuthUser: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Clear this device's local data so the app resets to a fresh state. */
  clearLocal: () => void;
}

export interface DeletionResult {
  deletedVehicles: number;
  leftVehicles: number;
  /** Per-step errors that didn't abort the run (best-effort cleanup), keyed by step. */
  errors: string[];
  /** True once the Firebase Auth login was actually deleted. False when we aborted before it because
   *  data cleanup failed (so the user is still signed in and nothing was orphaned). */
  authDeleted: boolean;
}

/**
 * Execute the deletion plan, then — ONLY IF all data cleanup succeeded — delete the user's own doc,
 * delete the Auth user, clear local data, and sign out.
 *
 * CRITICAL ORDERING (fixes the "deleted account left the boat + user" bug): the Firebase Auth login is
 * deleted LAST, and we ABORT before deleting it if any vehicle/user-doc delete failed. Deleting the
 * login while data deletes were denied (e.g. stale rules, a shared boat, a transient error) would
 * orphan the remaining vehicles/user-doc behind an account the user can no longer sign into to retry.
 * On abort we leave the user signed in (no clearLocal/signOut) so they can fix the cause and retry.
 *
 * `precheckErrors` lets the caller fold in failures from steps it ran first (e.g. ownership transfers)
 * so those also block the irreversible Auth deletion. Orchestration only; deps do the I/O.
 */
export async function executeAccountDeletion(
  plan: DeletionPlan, uid: string, deps: DeletionDeps, precheckErrors: string[] = [],
): Promise<DeletionResult> {
  const errors: string[] = [...precheckErrors];
  let deletedVehicles = 0;
  let leftVehicles = 0;

  for (const vid of plan.toDelete) {
    try { await deps.deleteVehicle(vid); deletedVehicles++; }
    catch (e: any) { errors.push(`delete ${vid}: ${e?.message || e}`); }
  }
  for (const vid of plan.toLeave) {
    try { await deps.leaveVehicle(vid, uid); leftVehicles++; }
    catch (e: any) { errors.push(`leave ${vid}: ${e?.message || e}`); }
  }
  try { await deps.deleteUserDoc(uid); } catch (e: any) { errors.push(`user doc: ${e?.message || e}`); }

  // Abort before the irreversible Auth deletion if ANY data cleanup failed — never orphan data behind
  // a deleted login. The user stays signed in (no clearLocal/signOut) so the retry can complete it.
  if (errors.length) {
    return { deletedVehicles, leftVehicles, errors, authDeleted: false };
  }

  // Data fully cleaned → safe to remove the login, clear local, and (if Auth delete fails, e.g.
  // requires-recent-login) sign out so the session ends and a re-auth retry can finish it.
  let authDeleted = false;
  try { await deps.deleteAuthUser(); authDeleted = true; }
  catch (e: any) { errors.push(`auth: ${e?.message || e}`); }

  deps.clearLocal();
  if (!authDeleted) {
    try { await deps.signOut(); } catch (e: any) { errors.push(`signout: ${e?.message || e}`); }
  }

  return { deletedVehicles, leftVehicles, errors, authDeleted };
}
