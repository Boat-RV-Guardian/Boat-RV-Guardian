import { useEffect, useMemo, useState } from 'react';
import { getDevices, type DeviceConfig } from '../utils/VehicleManager';
import { useShellyStatus } from '../hooks/useShellyStatus';
import { useLinkTapCloudState } from '../hooks/useLinkTapCloudState';
import { sensorReading, type TileLevel } from '../utils/sensorDisplay';
import { recordReading, getReadings } from '../utils/readingHistory';
import { mergeDeviceLogs, currentIssues, type AlertEvent } from '../utils/alerts';
import type { AlertLog } from '../hooks/useDeviceHistory';
import {
  getVehicleLocation, saveVehicleLocation, acquirePosition, formatCoords, parseCoords, timeAgo, mapsUrl,
  type VehicleLocation,
} from '../utils/vehicleLocation';
import MetricCard from '../components/dash/MetricCard';
import Sparkline from '../components/dash/Sparkline';
import MiniMap from '../components/dash/MiniMap';

type CatKey = 'fresh_water' | 'high_water' | 'batteries' | 'shore_power' | 'environment';

interface HomeProps {
  onNavigate: (view: CatKey) => void;
}

// Role → card chrome + drill-in category for the Shelly sensor cards.
const ROLE_META: Record<string, { icon: string; color: string; cat: CatKey }> = {
  'Flood Sensor':         { icon: '🚨', color: '#3b82f6', cat: 'high_water' },
  'Low Power Sensor':     { icon: '🔋', color: '#10b981', cat: 'batteries' },
  'High Power Sensor':    { icon: '⚡', color: '#f59e0b', cat: 'shore_power' },
  'Environmental Sensor': { icon: '🌡️', color: '#a78bfa', cat: 'environment' },
};

// Cards with problems float first; otherwise a stable role order.
const ROLE_ORDER = ['Flood Sensor', 'Low Power Sensor', 'High Power Sensor', 'Environmental Sensor'];
const LEVEL_RANK: Record<string, number> = { crit: 0, warn: 1, ok: 2, none: 3 };

const readLog = (deviceId: string): AlertLog[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(`lt_event_log_${deviceId}`) || 'null');
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
};

const EVENT_ICON: Record<AlertLog['type'], string> = { danger: '🚨', warning: '⚠️', success: '✅', info: 'ℹ️' };

const openExternal = (url: string) => {
  const isTauri = typeof window !== 'undefined' && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).isTauri);
  if (isTauri) import('@tauri-apps/plugin-shell').then(({ open }) => open(url)).catch(() => window.open(url, '_blank'));
  else window.open(url, '_blank', 'noopener');
};

// --- Shelly sensor card --------------------------------------------------------------------------

function SensorCard({ device, onNavigate, onLevel }: {
  device: DeviceConfig;
  onNavigate: (cat: CatKey) => void;
  onLevel: (id: string, level: TileLevel) => void;
}) {
  const { data, source } = useShellyStatus(device);
  const meta = ROLE_META[device.role] ?? { icon: '📟', color: '#64748b', cat: 'batteries' as CatKey };
  const reading = sensorReading(device, data);
  const [, bump] = useState(0); // re-read the history buffer after a point is recorded

  // Record the numeric reading into the local sparkline history (throttled inside recordReading).
  useEffect(() => {
    if (reading.value != null && recordReading(device.id, reading.value)) bump((n) => n + 1);
  }, [device.id, reading.value]);

  // Report our status level up so the hero strip can summarize.
  useEffect(() => { onLevel(device.id, reading.level); }, [device.id, reading.level, onLevel]);

  const points = getReadings(device.id);
  const series = points.map((p) => p.v);
  const lastAt = points.length ? points[points.length - 1].t : null;

  return (
    <MetricCard
      icon={meta.icon}
      iconColor={meta.color}
      title={device.name || device.role}
      badge={reading.badge}
      primary={reading.primary}
      unit={reading.unit}
      secondary={reading.secondary}
      level={reading.level}
      onClick={() => onNavigate(meta.cat)}
      footer={
        <>
          {series.length >= 2 && <Sparkline values={series} color={meta.color} />}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            <span>{source === 'local' ? '🏠 Local' : source === 'cloud' ? '☁️ Cloud' : 'No data yet'}</span>
            <span>{lastAt ? timeAgo(lastAt) : ''}</span>
          </div>
        </>
      }
    />
  );
}

// --- LinkTap valve card --------------------------------------------------------------------------

function ValveCard({ device, onNavigate, onLevel }: {
  device: DeviceConfig;
  onNavigate: (cat: CatKey) => void;
  onLevel: (id: string, level: TileLevel) => void;
}) {
  const state = useLinkTapCloudState(device.linktapDeviceId || device.id);
  const imperial = (localStorage.getItem('lt_unit') || 'imperial') === 'imperial';
  const open = state?.isWatering === true;
  const alarm = state?.alarm && state.alarm !== 'noError' ? state.alarm : null;
  const flow = open && state?.flow != null ? (imperial ? state.flow * 0.264172 : state.flow) : null;
  const level: TileLevel = alarm ? 'crit' : open ? 'warn' : state ? 'ok' : 'none';

  useEffect(() => { onLevel(device.id, level); }, [device.id, level, onLevel]);

  return (
    <MetricCard
      icon="💧"
      iconColor="#22d3ee"
      title={device.name || 'Fresh Water Valve'}
      badge={alarm ? { t: alarm.toUpperCase(), c: '#ef4444' } : open ? { t: 'OPEN', c: '#22d3ee' } : state ? { t: 'CLOSED', c: '#10b981' } : null}
      primary={open ? (flow != null ? flow.toFixed(1) : 'Open') : state ? 'Closed' : '—'}
      unit={open && flow != null ? (imperial ? 'gal/min' : 'L/min') : ''}
      secondary={[
        state?.battery != null ? `🔋 ${state.battery}%` : null,
        state?.signal != null ? `📶 ${state.signal}%` : null,
      ].filter(Boolean).join(' · ') || 'Fresh water'}
      level={level}
      onClick={() => onNavigate('fresh_water')}
      footer={
        <>
          {open && (
            <div className="wave-container" style={{ height: '34px', marginTop: 0 }}>
              <div className="wave wave-bg" /><div className="wave wave-fg" />
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            <span>Tap for flow & control</span>
            <span>{state?.at ? timeAgo(state.at) : ''}</span>
          </div>
        </>
      }
    />
  );
}

// --- Location card -------------------------------------------------------------------------------

function LocationCard() {
  const [loc, setLoc] = useState<VehicleLocation | null>(() => getVehicleLocation());
  const [zoom, setZoom] = useState(13);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [manual, setManual] = useState(false);
  const [manualText, setManualText] = useState('');

  useEffect(() => {
    const refresh = () => setLoc(getVehicleLocation());
    window.addEventListener('settings_updated', refresh);
    return () => window.removeEventListener('settings_updated', refresh);
  }, []);

  const useDeviceGps = async () => {
    setBusy(true); setErr('');
    try {
      const p = await acquirePosition();
      saveVehicleLocation({ lat: p.lat, lon: p.lon, acc: p.acc, ts: Date.now(), src: 'device' });
    } catch (e: any) {
      setErr(e?.message || 'Could not get a location fix.');
    } finally { setBusy(false); }
  };

  const saveManual = () => {
    const p = parseCoords(manualText);
    if (!p) { setErr('Enter as "lat, lon" in decimal degrees, e.g. 39.0968, -120.0324'); return; }
    setErr('');
    saveVehicleLocation({ lat: p.lat, lon: p.lon, ts: Date.now(), src: 'manual' });
    setManual(false); setManualText('');
  };

  return (
    <div className="metric-card metric-static">
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
        <span className="metric-icon" style={{ background: 'rgba(34,211,238,0.12)', border: '1px solid rgba(34,211,238,0.27)' }}>📍</span>
        <span style={{ flex: 1, fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Location</span>
        {loc && <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{loc.src === 'device' ? 'GPS' : 'Manual'} · {timeAgo(loc.ts)}</span>}
      </div>

      {loc ? (
        <>
          <MiniMap lat={loc.lat} lon={loc.lon} zoom={zoom} onZoom={setZoom} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.78rem', color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{formatCoords(loc.lat, loc.lon)}</span>
            <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: '0.72rem' }} onClick={() => openExternal(mapsUrl(loc.lat, loc.lon))}>🗺 Open in Maps</button>
          </div>
        </>
      ) : (
        <p style={{ margin: '4px 0 10px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          No position saved yet. Pin your vehicle with this device's GPS, or enter coordinates.
        </p>
      )}

      <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
        <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: '0.75rem' }} disabled={busy} onClick={useDeviceGps}>
          {busy ? 'Getting fix…' : '📡 Use this device'}
        </button>
        <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: '0.75rem' }} onClick={() => { setManual((m) => !m); setErr(''); }}>
          ✏️ Enter manually
        </button>
      </div>

      {manual && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <input
            className="form-input"
            style={{ fontSize: '0.8rem', padding: '7px 10px' }}
            placeholder="39.0968, -120.0324"
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveManual(); }}
          />
          <button className="btn-primary" style={{ padding: '6px 14px', fontSize: '0.8rem' }} onClick={saveManual}>Save</button>
        </div>
      )}
      {err && <p style={{ margin: '8px 0 0', fontSize: '0.75rem', color: '#f59e0b' }}>{err}</p>}
    </div>
  );
}

// --- Activity rail card --------------------------------------------------------------------------

function ActivityCard({ events }: { events: AlertEvent[] }) {
  const recent = events.slice(0, 6);
  return (
    <div className="metric-card metric-static">
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        <span className="metric-icon" style={{ background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.27)' }}>🔔</span>
        <span style={{ flex: 1, fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Recent activity</span>
        <button
          className="btn-secondary"
          style={{ padding: '3px 10px', fontSize: '0.7rem' }}
          onClick={() => window.dispatchEvent(new CustomEvent('navigate_view', { detail: 'alerts' }))}
        >
          View all →
        </button>
      </div>
      {recent.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>No events recorded yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {recent.map((e, i) => (
            <div key={`${e.deviceId}-${e.ts}-${i}`} style={{ display: 'flex', gap: '8px', alignItems: 'baseline', padding: '6px 0', borderBottom: i < recent.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
              <span style={{ fontSize: '0.8rem' }}>{EVENT_ICON[e.type]}</span>
              <span style={{ flex: 1, fontSize: '0.76rem', color: 'var(--text-secondary)', minWidth: 0 }}>
                <strong style={{ color: '#fff' }}>{e.deviceName}</strong> {e.message}
              </span>
              <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{timeAgo(e.ts)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- The Dashboard -------------------------------------------------------------------------------

export default function Home({ onNavigate }: HomeProps) {
  const [devices, setDevices] = useState<DeviceConfig[]>(() => getDevices());
  const [levels, setLevels] = useState<Record<string, TileLevel>>({});
  const [alertState, setAlertState] = useState(() => {
    const events = mergeDeviceLogs(getDevices().map((d) => ({ id: d.id, name: d.name })), readLog);
    return { events, issues: currentIssues(events, Date.now()) };
  });

  useEffect(() => {
    const refresh = () => {
      const devs = getDevices();
      setDevices(devs);
      const events = mergeDeviceLogs(devs.map((d) => ({ id: d.id, name: d.name })), readLog);
      setAlertState({ events, issues: currentIssues(events, Date.now()) });
    };
    window.addEventListener('settings_updated', refresh);
    return () => window.removeEventListener('settings_updated', refresh);
  }, []);

  const onLevel = useMemo(() => (id: string, level: TileLevel) =>
    setLevels((prev) => (prev[id] === level ? prev : { ...prev, [id]: level })), []);

  const valves = devices.filter((d) => d.type === 'linktap_valve');
  const sensors = devices
    .filter((d) => d.type === 'shelly_sensor' && d.enabled !== false)
    .sort((a, b) => {
      const la = LEVEL_RANK[levels[a.id] ?? 'none'] ?? 3;
      const lb = LEVEL_RANK[levels[b.id] ?? 'none'] ?? 3;
      if (la !== lb) return la - lb;
      return ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
    });

  const vesselName = localStorage.getItem('lt_vessel_name') || 'My Vehicle';
  const vehicleType = localStorage.getItem('lt_vehicle_type') || '';
  const critCount = Object.values(levels).filter((l) => l === 'crit').length + alertState.issues.length;
  const warnCount = Object.values(levels).filter((l) => l === 'warn').length;
  const allNormal = critCount === 0;

  // No page padding of its own — this renders inside Systems' padded container (Dashboard section).
  return (
    <div style={{ color: '#fff' }}>
      {/* Hero strip */}
      <div className="dash-hero">
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.5rem' }}>{vehicleType === 'rv' ? '🚐' : '🚤'}</span>
            <h1 style={{ fontSize: '1.7rem', margin: 0, background: 'linear-gradient(90deg,#fff,#00f2fe)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vesselName}</h1>
          </div>
          <p style={{ margin: '2px 0 0 0', fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Live systems dashboard
          </p>
        </div>
        <div className={`status-chip ${allNormal ? 'status-ok' : 'status-alert'}`}>
          <span className={`status-dot ${allNormal ? 'online' : 'offline'}`} />
          {allNormal
            ? (warnCount > 0 ? `Normal · ${warnCount} active` : 'All systems normal')
            : `${critCount} need${critCount === 1 ? 's' : ''} attention`}
        </div>
      </div>

      {/* Needs-attention banner (only when something is wrong) */}
      {alertState.issues.length > 0 && (
        <div className="glass-card danger" style={{ padding: '12px 16px', marginBottom: '14px' }}>
          {alertState.issues.slice(0, 3).map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'baseline', fontSize: '0.82rem' }}>
              <span>{EVENT_ICON[e.type]}</span>
              <span style={{ flex: 1 }}><strong>{e.deviceName}</strong> — {e.message}</span>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{timeAgo(e.ts)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="dash-body">
        <section className="dash-grid">
          {valves.map((d) => <ValveCard key={d.id} device={d} onNavigate={onNavigate} onLevel={onLevel} />)}
          {sensors.map((d) => <SensorCard key={d.id} device={d} onNavigate={onNavigate} onLevel={onLevel} />)}
          {devices.length === 0 && (
            <div className="glass-card" style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)', gridColumn: '1 / -1' }}>
              No devices yet. Add devices in Settings → Devices to populate your dashboard.
            </div>
          )}
        </section>

        <aside className="dash-rail">
          <LocationCard />
          <ActivityCard events={alertState.events} />
        </aside>
      </div>
    </div>
  );
}
