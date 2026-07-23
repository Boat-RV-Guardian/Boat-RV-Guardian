// Remembered Wi-Fi credentials for a vehicle's own network, used to prefill device provisioning
// (BLE + Wi-Fi-AP `Wifi.SetConfig`). Retyping an SSID/password on every sensor add has been a real
// provisioning failure mode — an autocapitalised password was an actual root-caused bug.
//
// STORAGE DECISION (owner, 2026-07-23): device-local, NEVER synced.
//   - The key lives OUTSIDE `VEHICLE_DEFAULT_CONFIG`/`VEHICLE_KEYS`, so `getLocalVehicleConfig` never
//     picks it up and it is never written to Firestore. A vehicle's members — including view-only
//     monitors — therefore cannot read it, which is the whole point: sharing a boat should not share
//     the network password.
//   - It IS in the `sh_*` namespace, so `applyUserScope` wipes it when the signed-in identity changes.
//     That's deliberate for a credential: it must not survive into another account's session.
//   - Cost of the choice: you re-enter it once per device you provision from. That's the trade the
//     owner picked over syncing a plaintext network password to the cloud.
//
// Reveal/prefill is additionally gated to admin/control roles (see canManageWifi) so a monitor who
// somehow has a local copy still isn't handed the password by the UI.

export interface VehicleWifi {
  ssid: string;
  password: string;
  /** epoch ms (UTC) the credentials were saved — displayed via utils/time. */
  savedAt: number;
}

/** Per-vehicle key. `sh_` namespace ⇒ wiped on identity change; not a VEHICLE_KEY ⇒ never synced. */
export const wifiKey = (vehicleId: string) => `sh_wifi_${vehicleId}`;

/** Roles allowed to see or reuse the saved network password. Unset role = owner/admin (legacy). */
export function canManageWifi(role: string | null | undefined): boolean {
  const r = role || 'admin';
  return r === 'admin' || r === 'control';
}

export function loadVehicleWifi(vehicleId: string, storage: Storage = localStorage): VehicleWifi | null {
  if (!vehicleId) return null;
  try {
    const raw = JSON.parse(storage.getItem(wifiKey(vehicleId)) || 'null');
    if (!raw || typeof raw.ssid !== 'string' || !raw.ssid) return null;
    return {
      ssid: raw.ssid,
      password: typeof raw.password === 'string' ? raw.password : '',
      savedAt: Number.isFinite(raw.savedAt) ? raw.savedAt : 0,
    };
  } catch { return null; }
}

/** Save (or overwrite) the vehicle's network credentials. A blank SSID clears instead. */
export function saveVehicleWifi(
  vehicleId: string, ssid: string, password: string,
  now = Date.now(), storage: Storage = localStorage,
): void {
  if (!vehicleId) return;
  if (!ssid.trim()) { clearVehicleWifi(vehicleId, storage); return; }
  const rec: VehicleWifi = { ssid: ssid.trim(), password, savedAt: now };
  try { storage.setItem(wifiKey(vehicleId), JSON.stringify(rec)); } catch { /* quota */ }
}

export function clearVehicleWifi(vehicleId: string, storage: Storage = localStorage): void {
  if (!vehicleId) return;
  try { storage.removeItem(wifiKey(vehicleId)); } catch { /* ignore */ }
}

/** Credentials to prefill a provisioning form with — null when absent or the role isn't allowed. */
export function wifiPrefill(
  vehicleId: string, role: string | null | undefined, storage: Storage = localStorage,
): VehicleWifi | null {
  if (!canManageWifi(role)) return null;
  return loadVehicleWifi(vehicleId, storage);
}

/** Mask an SSID/password for display: keeps the shape without showing the secret. */
export function maskSecret(value: string): string {
  if (!value) return '';
  return '•'.repeat(Math.min(value.length, 12));
}
