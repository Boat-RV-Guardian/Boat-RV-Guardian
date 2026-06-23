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

/**
 * App-level bridge for sleepy-sensor local webhooks. Mounted once (in App) so it runs regardless of
 * which page is open — the per-widget listener only worked while that sensor's widget was on screen.
 *
 * On a `shelly-local-event` (desktop axum listener), it: strikes Shelly.GetStatus at the awake
 * device's source IP, caches + broadcasts the status so any mounted widget updates, freshens the
 * stored IP, and self-heals the device's local webhook to the current app LAN IP.
 */
export function useSensorBridge() {
  useEffect(() => {
    if (!isTauriEnv()) return;
    let unlisten: any;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen('shelly-local-event', async (e: any) => {
        const p = e?.payload || {};
        if (!p.ip || !p.device) return;
        const dev = getDevices().find(d => d.type === 'shelly_sensor' && d.shellyDeviceId === p.device);
        if (!dev || dev.enabled === false) return;
        const pw = localStorage.getItem('sh_local_password') || undefined;

        // Strike: pull full telemetry while the device is briefly awake.
        try {
          const json = await shellyRpc(p.ip, 'Shelly.GetStatus', {}, pw);
          if (json && !json.error) {
            try { localStorage.setItem(lastStatusKey(p.device), JSON.stringify({ at: Date.now(), status: json })); } catch { /* quota */ }
            window.dispatchEvent(new CustomEvent('shelly_status', { detail: { deviceId: p.device, status: json } }));
          }
        } catch { /* may have slept again before we struck */ }

        // Keep the stored IP fresh.
        if (p.ip !== dev.localIp) updateDevice(dev.id, { localIp: p.ip });

        // Self-heal the device's local webhook to our current LAN IP (DHCP churn).
        try {
          const appIp = await invokeTauri('get_local_ip') as string;
          if (appIp && appIp !== dev.webhookAppIp) {
            await refreshLocalShellyWebhooks(
              (m, params) => shellyRpc(p.ip, m, params, pw),
              `http://${appIp}:3030`, p.vid || getActiveVehicleId() || '', dev.shellyDeviceId || '');
            updateDevice(dev.id, { webhookAppIp: appIp });
          }
        } catch { /* best-effort */ }
      });
    })();
    return () => { if (unlisten) unlisten(); };
  }, []);
}
