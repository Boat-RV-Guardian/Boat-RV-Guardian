// Pure helpers for the local-only ↔ cloud account-mode UX (Settings → Account). The mode state
// machine itself lives in utils/userScope.ts; this only derives the copy the AccountPanel shows when
// it offers a local-only user the switch to a hosted-cloud account.
//
// Per the "Configuration sync model" in CLAUDE.md (2026-06-29): a device is EITHER cloud OR local —
// no hybrid. The sanctioned local→cloud transition is a REBUILD: signing in from local mode makes
// applyUserScope() wipe the local session, so the user starts fresh in the cloud. Local vehicles are
// NOT migrated yet (the "migrate" flow is still open in Task 15), so the user must be warned that the
// device-only data won't be uploaded before they switch.

/**
 * Warning shown to a local-only user before switching to a cloud account. `localVehicleCount` is how
 * many vehicles currently live only on this device (and would therefore be discarded on the rebuild).
 */
export function cloudSwitchDiscardNote(localVehicleCount: number): string {
  if (localVehicleCount <= 0) {
    return 'Signing in starts a fresh cloud account on this device — nothing is stored locally yet, so nothing is lost.';
  }
  const vehicles = localVehicleCount === 1 ? '1 vehicle' : `${localVehicleCount} vehicles`;
  return `You have ${vehicles} stored only on this device. Switching to a cloud account starts you `
    + 'fresh in the cloud — your local data is not uploaded automatically (migration is coming later), '
    + 'so make sure you can re-create it before switching.';
}
