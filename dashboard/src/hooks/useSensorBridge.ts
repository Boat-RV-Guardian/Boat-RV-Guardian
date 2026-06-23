import { useEffect } from 'react';
import { getDevices, updateDevice, getActiveVehicleId } from '../utils/VehicleManager';
import { shellyRpc, refreshLocalShellyWebhooks } from '../utils/shellyRpc';
import { LocalServer, isAndroidNative } from '../utils/localServer';

const isTauriEnv = () =>
  typeof window !== 'undefined' && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).isTauri);

const invokeTauri = async (cmd: string, args?: any) => {
  if (!isTauriEnv()) throw new Error('Tauri API not available');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(cmd, args);
};

/** Cache key for a Shelly's last known status — read by ShellyWidget on mount for instant state. */
export const lastStatusKey = (deviceId: string) => `sh_last_status_${deviceId}`;

/** The app's LAN IPv4 — Tauri (desktop) or the Android plugin — for building the local webhook URL. */
async function getAppLanIp(): Promise<string | null> {
  try {
    if (isTauriEnv()) return (await invokeTauri('get_local_ip')) as string;
    if (isAndroidNative()) { const r = await LocalServer.getLocalIp(); return r?.ip || null; }
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
    if (appIp && appIp !== dev.webhookAppIp) {
      await refreshLocalShellyWebhooks(
        (m, params) => shellyRpc(ip, m, params, pw),
        `http://${appIp}:3030`, p.vid || getActiveVehicleId() || '', dev.shellyDeviceId || '');
      updateDevice(dev.id, { webhookAppIp: appIp });
    }
  } catch { /* best-effort */ }
}

/**
 * App-level bridge for sleepy-sensor local webhooks. Mounted once (in App) so it runs regardless of
 * which page is open. Desktop uses the Tauri axum listener; Android uses the native LocalServer
 * plugin (foreground service when "run in background" is enabled in Settings).
 */
export function useSensorBridge() {
  // Desktop (Tauri): the axum listener emits 'shelly-local-event'.
  useEffect(() => {
    if (!isTauriEnv()) return;
    let unlisten: any;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen('shelly-local-event', (e: any) => handleLocalEvent(e?.payload || {}));
    })();
    return () => { if (unlisten) unlisten(); };
  }, []);

  // Android (Capacitor): start/stop the native LocalServer per the Settings "Local Server Options"
  // toggles, and route its 'shellyLocalEvent' through the same handler.
  useEffect(() => {
    if (!isAndroidNative()) return;
    let listenerHandle: { remove: () => void } | undefined;
    let cancelled = false;
    let lastEnabled: boolean | null = null;
    let lastBackground: boolean | null = null;

    const apply = async () => {
      const enabled = localStorage.getItem('lt_local_server') !== 'false';
      const background = localStorage.getItem('lt_local_server_bg') === 'true';
      if (enabled === lastEnabled && background === lastBackground) return;
      lastEnabled = enabled; lastBackground = background;
      try {
        if (enabled) await LocalServer.start({ port: 3030, background });
        else await LocalServer.stop();
      } catch { /* plugin unavailable / start failed */ }
    };

    (async () => {
      try {
        const h = await LocalServer.addListener('shellyLocalEvent', (d) => handleLocalEvent(d));
        if (cancelled) h.remove(); else listenerHandle = h;
      } catch { /* ignore */ }
      await apply();
    })();

    const onSettings = () => { apply(); };
    window.addEventListener('settings_updated', onSettings);
    return () => {
      cancelled = true;
      window.removeEventListener('settings_updated', onSettings);
      if (listenerHandle) listenerHandle.remove();
    };
  }, []);
}
