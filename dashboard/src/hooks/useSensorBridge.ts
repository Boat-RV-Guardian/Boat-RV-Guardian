import { useEffect } from 'react';
import { getDevices, updateDevice, getActiveVehicleId } from '../utils/VehicleManager';
import { shellyRpc, refreshLocalShellyWebhooks } from '../utils/shellyRpc';

const isTauriEnv = () =>
  typeof window !== 'undefined' && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).isTauri);

const invokeTauri = async (cmd: string, args?: any) => {
  if (!isTauriEnv()) throw new Error('Tauri API not available');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(cmd, args);
};

/** Cache key for a Shelly's last known status — read by ShellyWidget on mount for instant state. */
export const lastStatusKey = (deviceId: string) => `sh_last_status_${deviceId}`;

/** The app's LAN IPv4 (Tauri desktop only) — for building the local webhook URL. */
async function getAppLanIp(): Promise<string | null> {
  try {
    if (isTauriEnv()) return (await invokeTauri('get_local_ip')) as string;
  } catch { /* ignore */ }
  return null;
}

/**
 * Handle a sleepy-sensor local webhook (from either the desktop axum listener or the Android plugin):
 * strike Shelly.GetStatus at the awake device's source IP, cache + broadcast the status so any mounted
 * widget updates, freshen the stored IP, and self-heal the device's local webhook to our current LAN IP.
 */
async function handleLocalEvent(p: { device?: string; event?: string; ip?: string; vid?: string }) {
  const ip = p?.ip;
  const device = p?.device;
  if (!ip || !device) return;
  const dev = getDevices().find(d => d.type === 'shelly_sensor' && d.shellyDeviceId === device);
  if (!dev || dev.enabled === false) return;
  const pw = localStorage.getItem('sh_local_password') || undefined;

  try {
    const json = await shellyRpc(ip, 'Shelly.GetStatus', {}, pw);
    if (json && !json.error) {
      try { localStorage.setItem(lastStatusKey(device), JSON.stringify({ at: Date.now(), status: json })); } catch { /* quota */ }
      window.dispatchEvent(new CustomEvent('shelly_status', { detail: { deviceId: device, status: json } }));
    }
  } catch { /* slept again before we struck */ }

  if (ip !== dev.localIp) updateDevice(dev.id, { localIp: ip });

  try {
    const appIp = await getAppLanIp();
    if (appIp) {
      // Always ensure (merge) — another instance may have clobbered our URL even if IP is unchanged.
      await refreshLocalShellyWebhooks(
        (m, params) => shellyRpc(ip, m, params, pw),
        `http://${appIp}:3030`, p.vid || getActiveVehicleId() || '', dev.shellyDeviceId || '',
        dev.webhookAppIp ? `http://${dev.webhookAppIp}:3030` : undefined);
      if (appIp !== dev.webhookAppIp) updateDevice(dev.id, { webhookAppIp: appIp });
    }
  } catch { /* best-effort */ }
}

/**
 * App-level bridge for sleepy-sensor local webhooks — DESKTOP (Tauri) ONLY. Mounted once (in App) so
 * it runs regardless of which page is open. The Tauri axum listener (always on, port 3030) emits
 * 'shelly-local-event'; a desktop app on the boat's LAN gets sensor pushes with no internet. The
 * Android in-app server + foreground service were removed 2026-07-08 (the phone app is a client, not
 * a backend — Android gets alerts via FCM from the cloud worker instead).
 */
export function useSensorBridge() {
  useEffect(() => {
    if (!isTauriEnv()) return;
    let unlisten: any;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen('shelly-local-event', (e: any) => handleLocalEvent(e?.payload || {}));
    })();
    return () => { if (unlisten) unlisten(); };
  }, []);
}
