// Pure helpers for the local-only ↔ cloud account-mode UX (Settings → Account). The mode state
// machine itself lives in utils/userScope.ts; this only derives the copy the AccountPanel shows when
// it offers a local-only user a way onto a hosted-cloud account.
//
// Per the "Configuration sync model" in CLAUDE.md (2026-06-29): a device is EITHER cloud OR local —
// no hybrid. Task 15 ships TWO sanctioned local→cloud transitions, both total (never a mix):
//  - REBUILD ("Switch to a cloud account"): signing in from local mode makes applyUserScope() wipe the
//    local session, so the user starts completely fresh in the cloud. Local vehicles are discarded.
//  - MIGRATE ("Migrate my vehicles to the cloud", utils/migrateLocalToCloud.ts): the local vehicles are
//    staged before sign-in and uploaded to the new cloud account right after, so nothing is lost.
// This note is shown above BOTH buttons, so its job is to distinguish them, not just warn about one.

/** Human label for the device's account mode, shown in the Account portal. */
export function accountModeLabel(signedIn: boolean, localMode: boolean): string {
  if (localMode) return 'Local-only (this device)';
  if (signedIn) return 'Cloud (synced)';
  return 'Signed out';
}

/**
 * Copy shown to a local-only user above the two local→cloud actions. `localVehicleCount` is how many
 * vehicles currently live only on this device.
 */
export function cloudSwitchDiscardNote(localVehicleCount: number): string {
  if (localVehicleCount <= 0) {
    return 'Signing in starts a fresh cloud account on this device — nothing is stored locally yet, so nothing is lost.';
  }
  const vehicles = localVehicleCount === 1 ? '1 vehicle' : `${localVehicleCount} vehicles`;
  return `You have ${vehicles} stored only on this device. "Switch to a cloud account" starts fresh in `
    + 'the cloud and discards this device\'s local data — use "Migrate my vehicles to the cloud" instead '
    + 'if you want to keep it; it uploads everything to the new cloud account before switching.';
}
