import { useState, useEffect, useRef } from 'react';
import type { DeviceConfig } from '../utils/VehicleManager';
import { getActiveVehicleId } from '../utils/VehicleManager';
import { nativeFetch } from '../utils/nativeFetch';
import { shellyRpc } from '../utils/shellyRpc';
import { db, doc, onSnapshot } from '../services/firebase';
import { mapCloudSensorDoc } from '../utils/shellySensorState';

const isTauriEnv = () => typeof window !== 'undefined' && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).isTauri);

const cloudFetch = async (url: string) => {
  if (isTauriEnv()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(url);
  }
  return nativeFetch(url) as any;
};

// Shared Shelly status source used by the Overview summary tiles. Three sources, in priority:
//   1. local RPC poll (fast, when the device is on our LAN and awake);
//   2. Shelly first-party cloud (legacy sh_server/sh_auth_key, rarely used);
//   3. the WORKER-cached sensorState (vehicles/{vid}/sensorState/{id}) via onSnapshot — the same
//      source the detail ShellyWidget reads. This is what makes SLEEPY/battery sensors (flood, H&T
//      environmental) show a value on the Overview tile: they're never polled, so without the cache
//      the tile showed "—" while the detail page (which reads the cache) showed the reading.
// A fresh local poll wins; the worker cache fills in otherwise.
export function useShellyStatus(device: DeviceConfig, intervalMs = 12000) {
  const [data, setData] = useState<any>(null);
  const [source, setSource] = useState<'local' | 'cloud' | null>(null);
  const lastLocalAtRef = useRef(0);

  // Worker-cached sensorState onSnapshot — carries sleepy sensors + off-LAN readings. Only fills in
  // when a local poll isn't fresh (within 20s), so a live LAN read isn't clobbered by a staler cache.
  useEffect(() => {
    if (device.enabled === false || !device.shellyDeviceId) return;
    // DEMO: no Firestore — tick the deterministic generator (same pattern as ShellyWidget).
    if (__DEMO__) {
      let stop = false;
      const tick = async () => {
        const [{ demoSpecFor }, { demoShellyDoc, demoFloodAlarmActive }, { getDemoOverride, mergeDemoDoc }] = await Promise.all([
          import('../utils/demoFleet'), import('../utils/demoTelemetry'), import('../utils/demoOverrides'),
        ]);
        if (stop) return;
        const spec = demoSpecFor(device.shellyDeviceId!);
        if (!spec) return;
        const now = Date.now();
        const base = demoShellyDoc(spec, now, spec.kind === 'flood' && demoFloodAlarmActive(now));
        const remote = mapCloudSensorDoc(device.role, mergeDemoDoc(base, getDemoOverride(spec.deviceId, now)));
        if (Object.keys(remote).length) { setData(remote); setSource('cloud'); }
      };
      tick();
      const id = setInterval(tick, 2000);
      const onSim = () => { tick(); };
      window.addEventListener('demo_sim', onSim);
      return () => { stop = true; clearInterval(id); window.removeEventListener('demo_sim', onSim); };
    }
    const vid = getActiveVehicleId();
    if (!vid) return;
    const ref = doc(db, 'vehicles', vid, 'sensorState', device.shellyDeviceId);
    const unsub = onSnapshot(ref, (snap: any) => {
      const d = snap.data();
      if (!d) return;
      if (Date.now() - lastLocalAtRef.current < 20000) return; // a fresh local poll wins
      const remote = mapCloudSensorDoc(device.role, d);
      if (Object.keys(remote).length) { setData(remote); setSource('cloud'); }
    }, () => {});
    return () => unsub();
  }, [device.enabled, device.shellyDeviceId, device.role]);

  useEffect(() => {
    let cancelled = false;
    const server = localStorage.getItem('sh_server') || '';
    const authKey = localStorage.getItem('sh_auth_key') || '';
    const localIp = device.localIp;

    const poll = async () => {
      if (localIp) {
        try {
          const j = await shellyRpc(localIp, 'Shelly.GetStatus', {}, localStorage.getItem('sh_local_password') || undefined);
          if (j && !j.error) { if (!cancelled) { setData(j); setSource('local'); lastLocalAtRef.current = Date.now(); } return; }
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
    // Battery/sleepy sensors aren't polled (they deep-sleep + drain on wake); the worker-cache
    // onSnapshot above carries them. One read on mount only in case one is awake right now.
    if (device.batteryPowered) return () => { cancelled = true; };
    const id = setInterval(poll, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [device.id, device.localIp, device.batteryPowered, intervalMs]);

  return { data, source };
}
