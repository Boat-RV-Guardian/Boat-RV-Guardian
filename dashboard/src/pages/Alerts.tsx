import { useState, useEffect } from 'react';
import { getDevices } from '../utils/VehicleManager';
import { mergeDeviceLogs, currentIssues, type AlertEvent } from '../utils/alerts';
import type { AlertLog } from '../hooks/useDeviceHistory';
import { formatDateTime } from '../utils/time';

// Alerts destination (Task 16 IA): a vehicle-scoped, unified timeline of the per-device Event Sentry
// Logs plus a "current issues" banner. Pure aggregation lives in utils/alerts; this reads each device's
// log from localStorage and renders. (Push-channel management moves here in a follow-up step.)

const readLog = (deviceId: string): AlertLog[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(`lt_event_log_${deviceId}`) || 'null');
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
};

const TYPE_STYLE: Record<AlertLog['type'], { color: string; icon: string }> = {
  danger:  { color: '#ef4444', icon: '🚨' },
  warning: { color: '#f59e0b', icon: '⚠️' },
  success: { color: '#10b981', icon: '✅' },
  info:    { color: 'var(--text-secondary)', icon: 'ℹ️' },
};

function load(): { events: AlertEvent[]; issues: AlertEvent[] } {
  const devices = getDevices().map((d) => ({ id: d.id, name: d.name }));
  const events = mergeDeviceLogs(devices, readLog);
  return { events, issues: currentIssues(events, Date.now()) };
}

export default function Alerts() {
  const [{ events, issues }, setState] = useState(load);

  useEffect(() => {
    const refresh = () => setState(load());
    window.addEventListener('settings_updated', refresh);
    return () => window.removeEventListener('settings_updated', refresh);
  }, []);

  const goNotificationPrefs = () => window.dispatchEvent(new CustomEvent('navigate_view', { detail: 'settings' }));

  return (
    <div style={{ padding: '20px', maxWidth: '900px', margin: '0 auto', color: '#fff', paddingBottom: '100px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '2rem', color: 'var(--accent-cyan)', margin: 0 }}>Alerts</h2>
        <button onClick={goNotificationPrefs} className="btn-secondary" style={{ padding: '6px 14px', fontSize: '0.85rem' }}>
          🔔 Notification preferences
        </button>
      </div>

      {/* Current issues */}
      {issues.length > 0 ? (
        <div className="glass-card" style={{ marginBottom: '16px', border: '1px solid rgba(239,68,68,0.4)' }}>
          <h3 style={{ margin: '0 0 10px', color: '#ef4444', fontSize: '1rem' }}>Needs attention ({issues.length})</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {issues.map((e, i) => (
              <div key={`${e.deviceId}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span>{TYPE_STYLE[e.type].icon}</span>
                <span style={{ flex: 1 }}><strong>{e.deviceName}</strong> — {e.message}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{formatDateTime(e.ts)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="glass-card" style={{ marginBottom: '16px', borderLeft: '3px solid #10b981' }}>
          <span style={{ color: '#10b981' }}>✅ All systems normal</span> — no active issues in the last 24 hours.
        </div>
      )}

      {/* Event history */}
      <div className="glass-card">
        <h3 style={{ marginTop: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>Recent events</h3>
        {events.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>No events recorded yet across this vehicle's devices.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {events.map((e, i) => (
              <div key={`${e.deviceId}-${e.ts}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: i < events.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                <span style={{ color: TYPE_STYLE[e.type].color }}>{TYPE_STYLE[e.type].icon}</span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', flexShrink: 0, width: '72px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.deviceName}</span>
                <span style={{ flex: 1, fontSize: '0.85rem' }}>{e.message}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', flexShrink: 0 }}>{formatDateTime(e.ts)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
