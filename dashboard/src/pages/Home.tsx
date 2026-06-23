import { useState, useEffect } from 'react';
import { getDevices, type DeviceConfig } from '../utils/VehicleManager';
import { useShellyStatus } from '../hooks/useShellyStatus';

type CatKey = 'fresh_water' | 'high_water' | 'batteries' | 'shore_power';

interface HomeProps {
  onNavigate: (view: CatKey) => void;
}

const CATEGORIES: { key: CatKey; icon: string; title: string; color: string; match: (d: DeviceConfig) => boolean }[] = [
  { key: 'fresh_water', icon: '💧', title: 'Fresh Water',        color: 'var(--accent-cyan)', match: (d) => d.type === 'linktap_valve' },
  { key: 'high_water',  icon: '🚨', title: 'High Water / Flood', color: '#3b82f6',            match: (d) => d.role === 'Flood Sensor' },
  { key: 'batteries',   icon: '🔋', title: 'Batteries',          color: '#10b981',            match: (d) => d.role === 'Low Power Sensor' },
  { key: 'shore_power', icon: '⚡', title: 'Shore Power',        color: '#f59e0b',            match: (d) => d.role === 'High Power Sensor' },
];

const num = (key: string, dflt: number) => Number(localStorage.getItem(key) ?? dflt) || dflt;

// Shelly Plus UNI has no Voltmeter component — its 0-30 V reading is an input of type "analog"
// (input:N { percent }). Mirror of ShellyWidget.uniAnalogVolts. See CLAUDE.md / shellyRpc.ts.
const uniAnalogVolts = (d: any): number | null => {
  for (let i = 0; i < 5; i++) {
    const inp = d?.[`input:${i}`];
    if (inp && typeof inp.percent === 'number') return (inp.percent / 100) * num('lt_uni_volt_fullscale', 30);
  }
  return null;
};

const DEFAULT_ORDER: CatKey[] = ['fresh_water', 'high_water', 'batteries', 'shore_power'];
const loadOrder = (): CatKey[] => {
  try {
    const saved = JSON.parse(localStorage.getItem('lt_dash_order') || 'null');
    if (Array.isArray(saved)) {
      const valid = saved.filter((k: any) => DEFAULT_ORDER.includes(k));
      // append any categories missing from saved order
      return [...valid, ...DEFAULT_ORDER.filter((k) => !valid.includes(k))];
    }
  } catch { /* ignore */ }
  return DEFAULT_ORDER;
};

// Compact live status for one Shelly device, rendered as a tile.
function ShellyTile({ device }: { device: DeviceConfig }) {
  const { data, source } = useShellyStatus(device);
  let primary = '—', secondary = '', badge: { t: string; c: string } | null = null;

  if (data) {
    if (device.role === 'High Power Sensor') {
      const power = data['pm1:0']?.apower ?? data['switch:0']?.apower ?? data['em:0']?.total_act_power ?? data.meters?.[0]?.power ?? 0;
      const v = data['pm1:0']?.voltage ?? data['switch:0']?.voltage ?? data['em:0']?.a_voltage ?? data.meters?.[0]?.voltage ?? 0;
      const cl = num('lt_shore_crit_low_v', 104), lo = num('lt_shore_low_v', 114), hi = num('lt_shore_high_v', 126), ch = num('lt_shore_crit_high_v', 132);
      badge = v <= cl ? { t: 'CRIT LOW', c: '#ef4444' } : v <= lo ? { t: 'LOW', c: '#f59e0b' } : v >= ch ? { t: 'CRIT HIGH', c: '#ef4444' } : v >= hi ? { t: 'HIGH', c: '#f59e0b' } : { t: 'NORMAL', c: '#10b981' };
      primary = `${Number(power).toFixed(0)} W`; secondary = `${Number(v).toFixed(1)} V`;
    } else if (device.role === 'Low Power Sensor') {
      const v = data['voltmeter:0']?.xvoltage ?? data['voltmeter:0']?.voltage
        ?? data['voltmeter:100']?.xvoltage ?? data['voltmeter:100']?.voltage
        ?? data.adcs?.[0]?.voltage ?? uniAnalogVolts(data) ?? 0;
      const crit = num('lt_batt_crit_v', 11.8), low = num('lt_batt_low_v', 12.2), charge = num('lt_batt_charge_v', 13.6), over = num('lt_batt_over_v', 15.0);
      badge = v <= crit ? { t: 'CRITICAL', c: '#ef4444' } : v <= low ? { t: 'LOW', c: '#f59e0b' } : v >= over ? { t: 'OVER', c: '#ef4444' } : v >= charge ? { t: 'CHARGING', c: '#22d3ee' } : { t: 'NORMAL', c: '#10b981' };
      primary = `${Number(v).toFixed(2)} V`; secondary = 'Battery';
    } else if (device.role === 'Flood Sensor') {
      const wet = !!(data['flood:0']?.alarm ?? data.flood?.alarm ?? false);
      badge = wet ? { t: 'FLOOD', c: '#ef4444' } : { t: 'DRY', c: '#3b82f6' };
      primary = wet ? '🚨 Wet' : '✅ Dry';
      const batt = data['devicepower:0']?.battery?.percent ?? data.device_power?.battery?.percent ?? data.bat?.value ?? null;
      secondary = batt != null ? `🔋 ${batt}%` : '';
    }
  }

  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{device.name || device.role}</span>
        {badge && <span style={{ fontSize: '0.6rem', fontWeight: 700, color: badge.c, background: `${badge.c}22`, padding: '1px 6px', borderRadius: '8px', whiteSpace: 'nowrap' }}>{badge.t}</span>}
      </div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, color: '#fff' }}>{primary}</div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{secondary}{source ? ` · ${source === 'local' ? '🏠' : '☁️'}` : ''}</div>
    </div>
  );
}

export default function Home({ onNavigate }: HomeProps) {
  const [devices, setDevices] = useState<DeviceConfig[]>(() => getDevices());
  const [order, setOrder] = useState<CatKey[]>(() => loadOrder());

  useEffect(() => {
    const refresh = () => setDevices(getDevices());
    window.addEventListener('settings_updated', refresh);
    return () => window.removeEventListener('settings_updated', refresh);
  }, []);

  const move = (idx: number, dir: -1 | 1) => {
    setOrder((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      localStorage.setItem('lt_dash_order', JSON.stringify(next));
      return next;
    });
  };

  const vesselName = localStorage.getItem('lt_vessel_name') || 'My Vehicle';

  return (
    <div style={{ padding: '20px', maxWidth: '1100px', margin: '0 auto', color: '#fff', paddingBottom: '100px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h1 style={{ fontSize: '1.8rem', margin: 0, background: 'linear-gradient(90deg,#fff,#00f2fe)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{vesselName}</h1>
          <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Dashboard · System Overview</p>
        </div>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Use ▲▼ to arrange by priority</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {order.map((key, idx) => {
          const cat = CATEGORIES.find((c) => c.key === key)!;
          const catDevices = devices.filter(cat.match);
          return (
            <div key={key} className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '10px' }}>
                <span style={{ fontSize: '1.4rem' }}>{cat.icon}</span>
                <h2 onClick={() => onNavigate(cat.key)} style={{ margin: 0, fontSize: '1.1rem', color: cat.color, cursor: 'pointer', flex: 1 }}>
                  {cat.title} <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 400 }}>({catDevices.length})</span>
                </h2>
                <button onClick={() => move(idx, -1)} disabled={idx === 0} className="btn-secondary" style={{ padding: '2px 8px', fontSize: '0.8rem', opacity: idx === 0 ? 0.3 : 1 }}>▲</button>
                <button onClick={() => move(idx, 1)} disabled={idx === order.length - 1} className="btn-secondary" style={{ padding: '2px 8px', fontSize: '0.8rem', opacity: idx === order.length - 1 ? 0.3 : 1 }}>▼</button>
                <button onClick={() => onNavigate(cat.key)} className="btn-secondary" style={{ padding: '2px 10px', fontSize: '0.75rem' }}>Open →</button>
              </div>

              {catDevices.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: 0 }}>No devices configured.</p>
              ) : cat.key === 'fresh_water' ? (
                // LinkTap valves: open the detailed page for live flow/control
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
                  {catDevices.map((d) => (
                    <div key={d.id} onClick={() => onNavigate('fresh_water')} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '12px', cursor: 'pointer' }}>
                      <div style={{ fontSize: '0.85rem', color: '#fff' }}>{d.name || 'Fresh Water Valve'}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>🚰 Tap to view flow & control</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
                  {catDevices.map((d) => <ShellyTile key={d.id} device={d} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {devices.length === 0 && (
        <div className="glass-card" style={{ textAlign: 'center', padding: '32px', marginTop: '16px', color: 'var(--text-secondary)' }}>
          No devices yet. Add devices in Settings → Devices to populate your dashboard.
        </div>
      )}
    </div>
  );
}
