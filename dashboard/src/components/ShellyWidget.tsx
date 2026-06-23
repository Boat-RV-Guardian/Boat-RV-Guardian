import { useState, useEffect, useRef } from 'react';
import { type DeviceConfig, getActiveVehicleId } from '../utils/VehicleManager';
import { nativeFetch } from '../utils/nativeFetch';
import { shellyRpc } from '../utils/shellyRpc';
import { formatTime } from '../utils/time';
import { db, doc, onSnapshot } from '../services/firebase';

const isTauriEnv = () => typeof window !== 'undefined' && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).isTauri);

const unifiedFetch = async (url: string, options?: any) => {
  if (isTauriEnv()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(url, { method: options?.method || 'GET', headers: options?.headers, body: options?.body });
  }
  return nativeFetch(url, options) as any;
};

const num = (key: string, dflt: number) => Number(localStorage.getItem(key) ?? dflt) || dflt;

// Compact SVG trend line with optional dashed threshold lines.
function Sparkline({ points, color, min, max, thresholds }: {
  points: number[]; color: string; min?: number; max?: number; thresholds?: { v: number; color: string }[];
}) {
  const w = 260, h = 64, pad = 5;
  if (points.length < 2) {
    return <div style={{ height: h, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>Collecting trend…</div>;
  }
  const lo = min ?? Math.min(...points);
  const hi = max ?? Math.max(...points);
  const range = (hi - lo) || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - 2 * pad);
  const y = (v: number) => pad + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / range) * (h - 2 * pad);
  const d = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ display: 'block' }}>
      {(thresholds || []).map((t, idx) => (t.v >= lo && t.v <= hi) ? (
        <line key={idx} x1={pad} x2={w - pad} y1={y(t.v)} y2={y(t.v)} stroke={t.color} strokeWidth="0.6" strokeDasharray="3 3" opacity="0.55" />
      ) : null)}
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export default function ShellyWidget({ device }: { device: DeviceConfig }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'local' | 'cloud' | 'ble' | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [shellyServer, setShellyServer] = useState('');
  const [shellyAuthKey, setShellyAuthKey] = useState('');
  // Track flood wet/dry transitions for the flood panel
  const lastFloodRef = useRef<boolean | null>(null);
  const [floodSince, setFloodSince] = useState<number | null>(null);
  const [cloudEvent, setCloudEvent] = useState<{ event: string; at: number } | null>(null);
  const localIp = device.localIp;

  // Offline mode: listen for the device's BTHome BLE advertisements (no internet/cloud). Native only.
  useEffect(() => {
    if (!device.batteryPowered) return;
    const Cap = (window as any).Capacitor;
    if (!Cap?.isNativePlatform?.()) return;
    const normMac = (s: string) => (s || '').toLowerCase().replace(/[^a-f0-9]/g, '');
    const targetMac = normMac(device.bleMac || '');
    const idMac = ((device.shellyDeviceId || '').match(/([0-9a-fA-F]{12})$/) || [])[1]?.toLowerCase() || '';
    const matchAdv = (m: string) =>
      (!!targetMac && m === targetMac) || (!!idMac && m.slice(0, 10) === idMac.slice(0, 10)); // BLE MAC last byte can differ

    let unsub: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { subscribeAdvertisements } = await import('../utils/shellyBle');
        const u = await subscribeAdvertisements((r) => {
          if (!matchAdv(r.mac)) return;
          setData((prev: any) => ({
            ...(prev || {}),
            ...(r.flood !== undefined ? { 'flood:0': { alarm: r.flood } } : {}),
            ...(r.battery !== undefined ? { 'devicepower:0': { battery: { percent: r.battery } } } : {}),
            ...(r.temperature !== undefined ? { 'temperature:0': { tC: r.temperature } } : {}),
          }));
          setSource('ble'); setError(null); setLastUpdated(Date.now());
        });
        if (cancelled) u(); else unsub = u;
      } catch { /* BLE unavailable */ }
    })();
    return () => { cancelled = true; if (unsub) unsub(); };
  }, [device.batteryPowered, device.bleMac, device.shellyDeviceId]);

  // Battery sensors: read the worker-cached last event (no polling needed) — works whenever online.
  useEffect(() => {
    if (!device.batteryPowered || !device.shellyDeviceId) return;
    const vid = getActiveVehicleId();
    if (!vid) return;
    const ref = doc(db, 'vehicles', vid, 'sensorState', device.shellyDeviceId);
    const unsub = onSnapshot(ref, (snap: any) => {
      const d = snap.data();
      if (d?.event) setCloudEvent({ event: d.event, at: Number(d.at) || 0 });
    }, () => {});
    return () => unsub();
  }, [device.batteryPowered, device.shellyDeviceId]);

  useEffect(() => {
    setShellyServer(localStorage.getItem('sh_server') || '');
    setShellyAuthKey(localStorage.getItem('sh_auth_key') || '');
  }, []);

  // Pull the role's primary trend metric out of a status object (same keys local + cloud).
  const extractMetric = (d: any): number | null => {
    if (device.role === 'High Power Sensor') return d['pm1:0']?.apower ?? d['switch:0']?.apower ?? d['em:0']?.total_act_power ?? d.meters?.[0]?.power ?? null;
    if (device.role === 'Low Power Sensor') return d['voltmeter:0']?.voltage ?? d['voltmeter:100']?.voltage ?? d.adcs?.[0]?.voltage ?? null;
    return null; // flood is binary — no continuous trend
  };

  const applyData = (statusObj: any, src: 'local' | 'cloud') => {
    setData(statusObj);
    setSource(src);
    setError(null);
    setLastUpdated(Date.now());
    const m = extractMetric(statusObj);
    if (m != null && !Number.isNaN(m)) setHistory(prev => [...prev, m].slice(-40));
    // Flood transition tracking
    if (device.role === 'Flood Sensor') {
      const wet = !!(statusObj['flood:0']?.alarm ?? statusObj.flood?.alarm ?? false);
      if (lastFloodRef.current !== wet) { lastFloodRef.current = wet; setFloodSince(Date.now()); }
    }
  };

  const fetchStatus = async () => {
    if (localIp) {
      try {
        const json = await shellyRpc(localIp, 'Shelly.GetStatus', {}, localStorage.getItem('sh_local_password') || undefined);
        if (json && !json.error) { applyData(json, 'local'); return; }
      } catch { /* fall back to cloud */ }
    }
    if (shellyServer && shellyAuthKey) {
      try {
        const res = await unifiedFetch(`https://${shellyServer}/device/status?id=${device.id}&auth_key=${shellyAuthKey}`);
        const json = await res.json();
        if (json.isok && json.data && json.data.device_status) { applyData(json.data.device_status, 'cloud'); return; }
      } catch { /* ignore */ }
      setError('Offline or Invalid');
    } else if (localIp) {
      setError('Unreachable on local network');
    }
  };

  useEffect(() => {
    // Battery/sleepy sensors (flood etc.) must NOT be polled — they deep-sleep, so polling just
    // times out (shows "down") and waking them drains the battery. They report on their wake cycle
    // and push real-time alerts via the cloud webhook. We do a single best-effort read on mount
    // (in case it's awake right now) and otherwise leave it alone; use 🔄 to read after a manual wake.
    if (device.batteryPowered) {
      if (localIp || (shellyServer && shellyAuthKey)) fetchStatus();
      // Opportunistic low-frequency poll: near-zero drain (the device only answers when awake),
      // and it reliably catches an ACTIVE flood since the alarm keeps the device awake.
      if (localIp) {
        const slow = setInterval(fetchStatus, 240000); // 4 min
        return () => clearInterval(slow);
      }
      return;
    }
    if (!localIp && !(shellyServer && shellyAuthKey)) return;
    fetchStatus();
    const interval = setInterval(fetchStatus, localIp ? 8000 : 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localIp, shellyServer, shellyAuthKey, device.id, device.batteryPowered]);

  let content = <div style={{ color: 'var(--text-muted)' }}>Loading…</div>;

  // Show last-known data first so a transient/asleep poll failure doesn't hide it.
  if (data) {
    if (device.role === 'High Power Sensor') {
      const power = data['pm1:0']?.apower ?? data['switch:0']?.apower ?? data['em:0']?.total_act_power ?? data.meters?.[0]?.power ?? 0;
      const voltage = data['pm1:0']?.voltage ?? data['switch:0']?.voltage ?? data['em:0']?.a_voltage ?? data.meters?.[0]?.voltage ?? 0;
      const critLow = num('lt_shore_crit_low_v', 95), low = num('lt_shore_low_v', 100), high = num('lt_shore_high_v', 128), critHigh = num('lt_shore_crit_high_v', 135);
      const status = voltage <= critLow ? { t: 'CRITICAL LOW', c: '#ef4444' } : voltage <= low ? { t: 'LOW', c: '#f59e0b' }
        : voltage >= critHigh ? { t: 'CRITICAL HIGH', c: '#ef4444' } : voltage >= high ? { t: 'HIGH', c: '#f59e0b' } : { t: 'NORMAL', c: '#10b981' };
      content = (
        <div style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: '1.8rem', fontWeight: 700, color: '#f59e0b' }}>{power.toFixed(1)} <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>W</span></span>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: status.c, background: `${status.c}22`, padding: '2px 8px', borderRadius: '10px' }}>{status.t}</span>
          </div>
          <div style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>{voltage.toFixed(1)} V</div>
          <Sparkline points={history} color="#f59e0b" />
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>Power trend (W)</div>
        </div>
      );
    } else if (device.role === 'Low Power Sensor') {
      const voltage = data['voltmeter:0']?.voltage ?? data['voltmeter:100']?.voltage ?? data.adcs?.[0]?.voltage ?? 0;
      const crit = num('lt_batt_crit_v', 11.5), low = num('lt_batt_low_v', 11.9), charge = num('lt_batt_charge_v', 13.2), over = num('lt_batt_over_v', 15.5);
      const status = voltage <= crit ? { t: 'CRITICAL', c: '#ef4444' } : voltage <= low ? { t: 'LOW', c: '#f59e0b' }
        : voltage >= over ? { t: 'OVER-VOLTAGE', c: '#ef4444' } : voltage >= charge ? { t: 'CHARGING', c: '#22d3ee' } : { t: 'NORMAL', c: '#10b981' };
      content = (
        <div style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: '1.8rem', fontWeight: 700, color: status.c }}>{voltage.toFixed(2)} <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>V</span></span>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: status.c, background: `${status.c}22`, padding: '2px 8px', borderRadius: '10px' }}>{status.t}</span>
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>Battery Monitor</div>
          <Sparkline points={history} color={status.c} min={crit - 0.4} max={over + 0.4}
            thresholds={[{ v: crit, color: '#ef4444' }, { v: low, color: '#f59e0b' }, { v: charge, color: '#22d3ee' }, { v: over, color: '#ef4444' }]} />
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>Voltage trend · thresholds {crit} / {low} / {charge} / {over} V</div>
        </div>
      );
    } else if (device.role === 'Flood Sensor') {
      const isFlood = !!(data['flood:0']?.alarm ?? data.flood?.alarm ?? false);
      const battery = data['devicepower:0']?.battery?.percent ?? data.device_power?.battery?.percent ?? data.bat?.value ?? null;
      const temp = data['temperature:0']?.tC ?? data.tmp?.tC ?? null;
      content = (
        <div style={{ width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: isFlood ? '#ef4444' : '#3b82f6', marginBottom: '6px' }}>
            {isFlood ? '🚨 FLOOD DETECTED' : '✅ DRY (SAFE)'}
          </div>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '6px' }}>
            {temp != null && <span>🌡️ {Number(temp).toFixed(1)}°C</span>}
            {battery != null && <span>🔋 {battery}%</span>}
          </div>
          {floodSince && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '8px' }}>{isFlood ? 'Wet' : 'Dry'} since {formatTime(floodSince)}</div>}
        </div>
      );
    } else {
      content = <div>Unknown Shelly Type</div>;
    }
  } else if (error && device.batteryPowered) {
    // Asleep with no reading yet — normal for a battery sensor, not a failure.
    content = (
      <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
        🔋 Battery sensor — asleep.<br />Real-time alerts arrive via push. Press the device button to wake it, then tap 🔄.
      </div>
    );
  } else if (error) {
    content = <div style={{ color: '#ef4444' }}>⚠️ {error}</div>;
  }

  return (
    <div className="glass-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
        <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--accent-orange)' }}>{device.name || `Shelly ${device.role}`}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {device.batteryPowered && (
            <button onClick={fetchStatus} title="Read now (device must be awake)" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.9rem', padding: '2px' }}>🔄</button>
          )}
          {device.batteryPowered && (
            <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '2px 6px', borderRadius: '8px', color: '#a3a3a3', background: 'rgba(255,255,255,0.08)' }}>🔋 BATTERY</span>
          )}
          {source && (
            <span style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.04em', padding: '2px 8px', borderRadius: '10px',
              color: source === 'cloud' ? 'var(--accent-cyan)' : '#10b981',
              background: source === 'cloud' ? 'rgba(0,242,254,0.1)' : 'rgba(16,185,129,0.12)' }}>
              {source === 'local' ? '🏠 LOCAL' : source === 'ble' ? '📡 BLE' : '☁️ CLOUD'}
            </span>
          )}
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', padding: '18px' }}>
        {content}
      </div>
      {device.batteryPowered && cloudEvent && (
        <div style={{ fontSize: '0.72rem', color: /alarm|flood|leak/i.test(cloudEvent.event) && !/off|clear|inactive/i.test(cloudEvent.event) ? '#ef4444' : 'var(--text-secondary)', textAlign: 'center', background: 'rgba(255,255,255,0.04)', borderRadius: '6px', padding: '4px' }}>
          📡 Last report: <strong>{cloudEvent.event}</strong>{cloudEvent.at ? ` · ${formatTime(cloudEvent.at)}` : ''}
        </div>
      )}
      {lastUpdated && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textAlign: 'right' }}>Updated {formatTime(lastUpdated)}</div>}
    </div>
  );
}
