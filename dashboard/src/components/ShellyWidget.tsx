import { useState, useEffect, useRef } from 'react';
import { type DeviceConfig, getActiveVehicleId } from '../utils/VehicleManager';
import { nativeFetch } from '../utils/nativeFetch';
import { shellyRpc } from '../utils/shellyRpc';
import { formatTime } from '../utils/time';
import { db, doc, onSnapshot } from '../services/firebase';
import { lastStatusKey } from '../hooks/useSensorBridge';

const isTauriEnv = () => typeof window !== 'undefined' && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).isTauri);

// Cloud-webhook self-heal is idempotent but does 3-4 device RPCs, so run it at most once per
// device+worker-base per app session (a base change, e.g. the Task 11 cutover, re-triggers it).
const cloudWebhookReconciled = new Set<string>();

const unifiedFetch = async (url: string, options?: any) => {
  if (isTauriEnv()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(url, { method: options?.method || 'GET', headers: options?.headers, body: options?.body });
  }
  return nativeFetch(url, options) as any;
};

const invokeTauri = async (cmd: string, args?: any) => {
  if (!isTauriEnv()) throw new Error('Tauri API not available');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(cmd, args);
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
  const [source, setSource] = useState<'local' | 'cloud' | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [shellyServer, setShellyServer] = useState('');
  const [shellyAuthKey, setShellyAuthKey] = useState('');
  // Track flood wet/dry transitions for the flood panel
  const lastFloodRef = useRef<boolean | null>(null);
  const [floodSince, setFloodSince] = useState<number | null>(null);
  const [cloudEvent, setCloudEvent] = useState<{ event: string; at: number } | null>(null);
  // When local polling last succeeded, and the current data source — used so worker-cached cloud
  // state only fills in when local is stale/absent (off-site), and a local "unreachable" doesn't
  // flicker over data we're already showing from the cloud.
  const lastLocalAtRef = useRef(0);
  const sourceRef = useRef<'local' | 'cloud' | null>(null);
  // The raw IP is the PRIMARY local address — reliable and fast. The mDNS .local host is only a
  // fallback for DHCP churn, and only on desktop/Tauri (mDNS over HTTP is flaky there and absent in
  // mobile WebViews). Derived from the Shelly id for devices added before mdnsHost was stored.
  const derivedMdns = device.mdnsHost
    || (device.shellyDeviceId && /shelly/i.test(device.shellyDeviceId) ? `${device.shellyDeviceId.toLowerCase()}.local` : undefined);
  // Ordered list of hosts to try: raw IP first, then .local (desktop only) as a churn fallback.
  const localHosts: string[] = [device.localIp, isTauriEnv() ? derivedMdns : undefined]
    .filter((h, i, a): h is string => !!h && a.indexOf(h) === i);
  const localIp = localHosts[0]; // "do we have a local address?" + primary host for reads

  // Flood sensors are inherently sleepy/battery, even if added before the batteryPowered flag was
  // stored — treat the role as battery-powered so they're never polled or shown as "unreachable".
  const isBattery = device.batteryPowered === true || device.role === 'Flood Sensor';


  // Worker-cached remote state (vehicles/{vid}/sensorState/{deviceId}): the device pushes alerts AND
  // periodic telemetry (voltage/temp/…) to the worker, which caches the values here. Read for EVERY
  // Shelly device so readings show remotely (off the LAN). Local polling wins while it's fresh; this
  // fills in when local is stale/absent (the off-site case). Also feeds the "last report" line.
  useEffect(() => {
    if (device.enabled === false || !device.shellyDeviceId) return;
    const vid = getActiveVehicleId();
    if (!vid) return;
    const ref = doc(db, 'vehicles', vid, 'sensorState', device.shellyDeviceId);
    const unsub = onSnapshot(ref, (snap: any) => {
      const d = snap.data();
      if (!d) return;
      if (d.event) setCloudEvent({ event: String(d.event), at: Number(d.at) || 0 });
      // Don't clobber a fresh local poll (home); only synthesize from the cloud when local is stale.
      if (Date.now() - lastLocalAtRef.current < 20000) return;
      const n = (x: any) => { const v = Number(x); return Number.isFinite(v) ? v : undefined; };
      const remote: any = {};
      if (d.v != null || d.vraw != null) {
        // Same `v` field, mapped to the shape each role's display reads: shore power → pm1:0.voltage,
        // DC battery/voltmeter → voltmeter:100.
        if (device.role === 'High Power Sensor') remote['pm1:0'] = { voltage: n(d.v) ?? n(d.vraw) };
        else remote['voltmeter:100'] = { id: 100, voltage: n(d.vraw), xvoltage: n(d.v) };
      }
      if (d.tC != null) remote['temperature:0'] = { tC: n(d.tC) };
      if (d.batt != null) remote['devicepower:0'] = { battery: { percent: n(d.batt) } };
      const ev = String(d.event || '');
      if (/flood|alarm|leak/i.test(ev)) remote['flood:0'] = { alarm: !/off|clear|inactive|dry/i.test(ev) };
      if (Object.keys(remote).length) applyData(remote, 'cloud');
    }, () => {});
    return () => unsub();
  }, [device.enabled, device.shellyDeviceId]);

  // The strike on a sleepy device's wake (GetStatus + self-heal) is handled app-level by
  // useSensorBridge so it runs regardless of the active page. Here we just consume the result:
  // read the cached last-status on mount for instant state, and update live on the broadcast.
  useEffect(() => {
    if (device.enabled === false || !device.shellyDeviceId) return;
    try {
      const cached = localStorage.getItem(lastStatusKey(device.shellyDeviceId));
      if (cached) { const { status } = JSON.parse(cached); if (status) applyData(status, 'local'); }
    } catch { /* ignore */ }
    const onStatus = (e: any) => {
      if (e?.detail?.deviceId === device.shellyDeviceId && e.detail.status) applyData(e.detail.status, 'local');
    };
    window.addEventListener('shelly_status', onStatus);
    return () => window.removeEventListener('shelly_status', onStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.id, device.shellyDeviceId, device.enabled]);

  useEffect(() => {
    setShellyServer(localStorage.getItem('sh_server') || '');
    setShellyAuthKey(localStorage.getItem('sh_auth_key') || '');
  }, []);

  // Shelly Plus UNI has NO Voltmeter component — its 0-30 V DC measurement comes from an INPUT
  // configured as type "analog", which reports as input:N { percent } (full-scale 0-100%).
  // Convert that to volts over the configured range (default 30 V). The input index isn't fixed,
  // so scan for the first input exposing a numeric percent (switch/count inputs don't).
  const uniAnalogVolts = (d: any): number | null => {
    for (let i = 0; i < 5; i++) {
      const inp = d?.[`input:${i}`];
      if (inp && typeof inp.percent === 'number') return (inp.percent / 100) * num('lt_uni_volt_fullscale', 30);
    }
    return null;
  };

  // Pull the role's primary trend metric out of a status object (same keys local + cloud).
  const extractMetric = (d: any): number | null => {
    // Shore power: track VOLTAGE, not wattage — these are voltage-only installs (the device isn't
    // wired inline for current), so apower is always ~0.
    if (device.role === 'High Power Sensor') return d['pm1:0']?.voltage ?? d['switch:0']?.voltage ?? d['em:0']?.a_voltage ?? d.meters?.[0]?.voltage ?? null;
    // Prefer xvoltage (device-side calibrated value) over the raw voltage when present.
    if (device.role === 'Low Power Sensor')
      return d['voltmeter:0']?.xvoltage ?? d['voltmeter:0']?.voltage
        ?? d['voltmeter:100']?.xvoltage ?? d['voltmeter:100']?.voltage
        ?? d.adcs?.[0]?.voltage ?? uniAnalogVolts(d);
    return null; // flood is binary — no continuous trend
  };

  const applyData = (statusObj: any, src: 'local' | 'cloud') => {
    setData(statusObj);
    setSource(src);
    sourceRef.current = src;
    if (src === 'local') lastLocalAtRef.current = Date.now();
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

  // Desktop-only: ensure this device has a LOCAL webhook pointing at our current LAN IP so it can
  // push events to us with no internet. Called whenever we've just reached the awake device locally
  // (provisioning, mount read, manual 🔄, or a strike) — which is also when DHCP churn self-heals.
  const ensureLocalWebhook = async (reachableHost: string) => {
    if (!isTauriEnv() || !device.shellyDeviceId) return;
    try {
      const appIp = await invokeTauri('get_local_ip') as string;
      if (!appIp) return;
      const pw = localStorage.getItem('sh_local_password') || undefined;
      const { refreshLocalShellyWebhooks } = await import('../utils/shellyRpc');
      // Always ensure (merge) — another instance may have clobbered our URL even if our IP is unchanged.
      await refreshLocalShellyWebhooks(
        (m, params) => shellyRpc(reachableHost, m, params, pw),
        `http://${appIp}:3030`, getActiveVehicleId() || '', device.shellyDeviceId,
        device.webhookAppIp ? `http://${device.webhookAppIp}:3030` : undefined);
      const { updateDevice } = await import('../utils/VehicleManager');
      if (appIp !== device.webhookAppIp) updateDevice(device.id, { webhookAppIp: appIp });
    } catch { /* best-effort */ }
  };

  // Signed-in cloud users: ensure the WORKER is a webhook target on this reachable device, so off-LAN
  // alerts + telemetry flow. Self-heals a device provisioned before its voltmeter peripheral existed
  // (its voltmeter.* hooks were never created) and re-points devices after the Task 11 worker cutover.
  // Merge semantics (refreshCloudShellyWebhooks) never clobber flood/other hooks. Throttled per session.
  const ensureCloudWebhook = async (reachableHost: string) => {
    if (!device.shellyDeviceId) return;
    const vid = getActiveVehicleId();
    if (!vid) return;
    try {
      const { isLocalMode } = await import('../utils/userScope');
      if (isLocalMode(localStorage)) return; // cloud-mode users only; local mode never uses the worker
      const { DEFAULT_WORKER_URL } = await import('../utils/configSync');
      const base = localStorage.getItem('sh_webhook_url') || DEFAULT_WORKER_URL;
      if (!base) return;
      const throttleKey = `${device.shellyDeviceId}|${base}`;
      if (cloudWebhookReconciled.has(throttleKey)) return;
      cloudWebhookReconciled.add(throttleKey); // mark before await so concurrent polls don't double-run
      try {
        const pw = localStorage.getItem('sh_local_password') || undefined;
        const key = localStorage.getItem('sh_webhook_url') ? (localStorage.getItem('sh_webhook_key') || '') : '';
        const { ensureWebhookSecret } = await import('../utils/webhookSecret');
        const { refreshCloudShellyWebhooks } = await import('../utils/shellyRpc');
        const prior = device.webhookCloudBase && device.webhookCloudBase !== base ? device.webhookCloudBase : undefined;
        await refreshCloudShellyWebhooks((m, params) => shellyRpc(reachableHost, m, params, pw), base, vid, device.shellyDeviceId, prior, key, ensureWebhookSecret());
        if (device.webhookCloudBase !== base) {
          const { updateDevice } = await import('../utils/VehicleManager');
          updateDevice(device.id, { webhookCloudBase: base });
        }
      } catch { cloudWebhookReconciled.delete(throttleKey); /* transient — retry on a later poll */ }
    } catch { /* best-effort */ }
  };

  const fetchStatus = async () => {
    // Raw IP first, then .local (desktop churn fallback). localHosts is already ordered + deduped.
    for (const host of localHosts) {
      try {
        const json = await shellyRpc(host, 'Shelly.GetStatus', {}, localStorage.getItem('sh_local_password') || undefined);
        if (json && !json.error) { applyData(json, 'local'); if (isBattery) ensureLocalWebhook(host); ensureCloudWebhook(host); return; }
      } catch { /* try next host / fall back to cloud */ }
    }
    if (shellyServer && shellyAuthKey) {
      try {
        const res = await unifiedFetch(`https://${shellyServer}/device/status?id=${device.id}&auth_key=${shellyAuthKey}`);
        const json = await res.json();
        if (json.isok && json.data && json.data.device_status) { applyData(json.data.device_status, 'cloud'); return; }
      } catch { /* ignore */ }
      // A sleeping battery sensor is EXPECTED to be unreachable — don't show it as an error;
      // last-known state (cache/BLE/cloud event) carries it instead. Also suppress when we're
      // already showing worker-cached cloud telemetry (off-site) so it doesn't flicker an error.
      if (!isBattery && sourceRef.current !== 'cloud') setError('Offline or Invalid');
    } else if (localIp && !isBattery && sourceRef.current !== 'cloud') {
      setError('Unreachable on local network');
    }
  };

  useEffect(() => {
    if (device.enabled === false) return; // disabled device — don't poll
    // Battery/sleepy sensors (flood etc.) must NOT be polled — they deep-sleep, so polling just
    // times out (shows "down") and waking them drains the battery. They report on their wake cycle
    // and push real-time alerts via the cloud webhook. We do a single best-effort read on mount
    // (in case it's awake right now) and otherwise leave it alone; use 🔄 to read after a manual wake.
    if (isBattery) {
      // One best-effort read in case it's awake right now (just provisioned / button pressed).
      // No interval: polling a deep-sleeping sensor only yields false "down" and is pointless —
      // real-time state arrives via the local webhook (shelly-local-event), BLE, or cloud cache.
      if (localIp || (shellyServer && shellyAuthKey)) fetchStatus();
      return;
    }
    if (!localIp && !(shellyServer && shellyAuthKey)) return;
    fetchStatus();
    const interval = setInterval(fetchStatus, localIp ? 8000 : 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localIp, shellyServer, shellyAuthKey, device.id, isBattery, device.enabled]);

  let content = <div style={{ color: 'var(--text-muted)' }}>Loading…</div>;

  // Show last-known data first so a transient/asleep poll failure doesn't hide it.
  if (data) {
    if (device.role === 'High Power Sensor') {
      const voltage = data['pm1:0']?.voltage ?? data['switch:0']?.voltage ?? data['em:0']?.a_voltage ?? data.meters?.[0]?.voltage ?? 0;
      const critLow = num('lt_shore_crit_low_v', 104), low = num('lt_shore_low_v', 114), normal = num('lt_shore_normal_v', 120), high = num('lt_shore_high_v', 126), critHigh = num('lt_shore_crit_high_v', 132);
      const status = voltage <= critLow ? { t: 'CRITICAL LOW', c: '#ef4444' } : voltage <= low ? { t: 'LOW', c: '#f59e0b' }
        : voltage >= critHigh ? { t: 'CRITICAL HIGH', c: '#ef4444' } : voltage >= high ? { t: 'HIGH', c: '#f59e0b' } : { t: 'NORMAL', c: '#10b981' };
      // Voltage-only: these installs aren't wired inline for current, so wattage is always ~0 and is
      // not shown. Voltage is the shore-power health signal.
      content = (
        <div style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: '1.8rem', fontWeight: 700, color: '#f59e0b' }}>{voltage.toFixed(1)} <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>V</span></span>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: status.c, background: `${status.c}22`, padding: '2px 8px', borderRadius: '10px' }}>{status.t}</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px' }}>nominal {normal} V</div>
          <Sparkline points={history} color="#f59e0b" />
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>Voltage trend (V)</div>
        </div>
      );
    } else if (device.role === 'Low Power Sensor') {
      const voltage = data['voltmeter:0']?.xvoltage ?? data['voltmeter:0']?.voltage
        ?? data['voltmeter:100']?.xvoltage ?? data['voltmeter:100']?.voltage
        ?? data.adcs?.[0]?.voltage ?? uniAnalogVolts(data) ?? 0;
      const crit = num('lt_batt_crit_v', 11.8), low = num('lt_batt_low_v', 12.2), normal = num('lt_batt_normal_v', 12.6), charge = num('lt_batt_charge_v', 13.6), over = num('lt_batt_over_v', 15.0);
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
            thresholds={[{ v: crit, color: '#ef4444' }, { v: low, color: '#f59e0b' }, { v: normal, color: '#94a3b8' }, { v: charge, color: '#22d3ee' }, { v: over, color: '#ef4444' }]} />
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>Voltage trend · nominal {normal} V · thresholds {crit} / {low} / {charge} / {over} V</div>
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
  } else if (error && isBattery) {
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
          {isBattery && (
            <button onClick={fetchStatus} title="Read now (device must be awake)" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.9rem', padding: '2px' }}>🔄</button>
          )}
          {isBattery && (
            <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '2px 6px', borderRadius: '8px', color: '#a3a3a3', background: 'rgba(255,255,255,0.08)' }}>🔋 BATTERY</span>
          )}
          {source && (
            <span style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.04em', padding: '2px 8px', borderRadius: '10px',
              color: source === 'cloud' ? 'var(--accent-cyan)' : '#10b981',
              background: source === 'cloud' ? 'rgba(0,242,254,0.1)' : 'rgba(16,185,129,0.12)' }}>
              {source === 'local' ? '🏠 LOCAL' : '☁️ CLOUD'}
            </span>
          )}
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', padding: '18px' }}>
        {content}
      </div>
      {isBattery && cloudEvent && (
        <div style={{ fontSize: '0.72rem', color: /alarm|flood|leak/i.test(cloudEvent.event) && !/off|clear|inactive/i.test(cloudEvent.event) ? '#ef4444' : 'var(--text-secondary)', textAlign: 'center', background: 'rgba(255,255,255,0.04)', borderRadius: '6px', padding: '4px' }}>
          📡 Last report: <strong>{cloudEvent.event}</strong>{cloudEvent.at ? ` · ${formatTime(cloudEvent.at)}` : ''}
        </div>
      )}
      {lastUpdated && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textAlign: 'right' }}>Updated {formatTime(lastUpdated)}</div>}
    </div>
  );
}
