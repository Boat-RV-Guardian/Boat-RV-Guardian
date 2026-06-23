import { useState, useEffect } from 'react';
import type { DeviceConfig } from '../utils/VehicleManager';
import { nativeFetch } from '../utils/nativeFetch';
import { shellyRpc } from '../utils/shellyRpc';

const isTauriEnv = () => typeof window !== 'undefined' && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).isTauri);

const cloudFetch = async (url: string) => {
  if (isTauriEnv()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(url);
  }
  return nativeFetch(url) as any;
};

// Shared Shelly status poller (local-first via RPC, cloud fallback) used by the Dashboard
// summary tiles. Mirrors ShellyWidget's fetch strategy in a lightweight, value-only form.
export function useShellyStatus(device: DeviceConfig, intervalMs = 12000) {
  const [data, setData] = useState<any>(null);
  const [source, setSource] = useState<'local' | 'cloud' | null>(null);

  useEffect(() => {
    let cancelled = false;
    const server = localStorage.getItem('sh_server') || '';
    const authKey = localStorage.getItem('sh_auth_key') || '';
    const localIp = device.localIp;

    const poll = async () => {
      if (localIp) {
        try {
          const j = await shellyRpc(localIp, 'Shelly.GetStatus', {}, localStorage.getItem('sh_local_password') || undefined);
          if (j && !j.error) { if (!cancelled) { setData(j); setSource('local'); } return; }
        } catch { /* fall back */ }
      }
      if (server && authKey) {
        try {
          const res = await cloudFetch(`https://${server}/device/status?id=${device.id}&auth_key=${authKey}`);
          const j = await res.json();
          if (j.isok && j.data?.device_status) { if (!cancelled) { setData(j.data.device_status); setSource('cloud'); } }
        } catch { /* ignore */ }
      }
    };

    poll();
    // Battery/sleepy sensors aren't polled (they deep-sleep + drain on wake); one read on mount only.
    if (device.batteryPowered) return () => { cancelled = true; };
    const id = setInterval(poll, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [device.id, device.localIp, device.batteryPowered, intervalMs]);

  return { data, source };
}
