import { useState } from 'react';
import { DEMO_EVENTS, runDemoEvent, runAllDemoEvents, type EventTone, type EventCategory } from '../utils/demoEvents';
import { clearDemoOverrides } from '../utils/demoOverrides';

// Top banner that simulates each sensor event on demand. Two roles:
//   - in a demo build it's the showcase's "try the alarms" control (mode="demo");
//   - in any build it can be enabled for QA (mode="test") to exercise the alert / dashboard UI without
//     hardware (Settings → Device Preferences → "Event simulator").
// Firing an event pins a transient telemetry override (tiles flip in demo builds) AND writes a real
// Event Sentry Log entry (Alerts + dashboard banner react in every build). See demoEvents.ts.

const TONE_COLOR: Record<EventTone, string> = {
  danger: '#ef4444', warning: '#f59e0b', success: '#10b981', info: '#22d3ee',
};

const CATEGORY_ORDER: EventCategory[] = ['Water', 'Power', 'Flood', 'Climate'];
const CATEGORY_ICON: Record<EventCategory, string> = { Water: '💧', Power: '🔋', Flood: '🚨', Climate: '🌡️' };

const COLLAPSE_KEY = 'lt_sim_collapsed';

export default function DemoEventBar({ mode }: { mode: 'demo' | 'test' }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [flash, setFlash] = useState<string | null>(null);

  const toggle = () => {
    setCollapsed((c) => { const next = !c; localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); return next; });
  };

  const fire = (label: string, fn: () => void) => {
    fn();
    setFlash(label);
    window.clearTimeout((fire as any)._t);
    (fire as any)._t = window.setTimeout(() => setFlash(null), 1800);
  };

  const barBg = mode === 'demo'
    ? 'linear-gradient(90deg, rgba(0,242,254,0.14), rgba(99,102,241,0.14))'
    : 'linear-gradient(90deg, rgba(245,158,11,0.14), rgba(239,68,68,0.12))';
  const accent = mode === 'demo' ? '#00f2fe' : '#f59e0b';

  return (
    <div style={{ background: barBg, borderBottom: `1px solid ${accent}44`, flexShrink: 0, zIndex: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 14px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          {mode === 'demo'
            ? <>🎬 <strong style={{ color: accent }}>Demo</strong> — simulated data. Trigger any event:</>
            : <>🧪 <strong style={{ color: accent }}>Event simulator</strong> (testing) — fire an event:</>}
        </span>
        {flash && <span style={{ fontSize: '0.78rem', color: accent, fontWeight: 600 }}>▶ {flash}</span>}
        <div style={{ flex: 1 }} />
        <button onClick={() => fire('All events', () => runAllDemoEvents())} className="btn-secondary" style={{ padding: '4px 12px', fontSize: '0.75rem' }}>⚡ Fire all</button>
        <button onClick={() => fire('Reset', () => { clearDemoOverrides(); window.dispatchEvent(new Event('settings_updated')); })} className="btn-secondary" style={{ padding: '4px 12px', fontSize: '0.75rem' }}>↺ Reset</button>
        <button onClick={toggle} className="btn-secondary" style={{ padding: '4px 10px', fontSize: '0.75rem' }} aria-expanded={!collapsed}>
          {collapsed ? 'Show ▾' : 'Hide ▴'}
        </button>
      </div>

      {!collapsed && (
        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', padding: '0 14px 10px' }}>
          {CATEGORY_ORDER.map((cat) => {
            const events = DEMO_EVENTS.filter((e) => e.category === cat);
            if (!events.length) return null;
            return (
              <div key={cat} style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <span style={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                  {CATEGORY_ICON[cat]} {cat}
                </span>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {events.map((ev) => {
                    const c = TONE_COLOR[ev.tone];
                    return (
                      <button
                        key={ev.id}
                        onClick={() => fire(ev.label, () => runDemoEvent(ev))}
                        title={ev.logMessage}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '5px',
                          padding: '5px 10px', fontSize: '0.74rem', fontWeight: 600,
                          borderRadius: '8px', cursor: 'pointer', whiteSpace: 'nowrap',
                          color: c, background: `${c}1a`, border: `1px solid ${c}55`,
                          fontFamily: 'var(--font-family)',
                        }}
                      >
                        <span aria-hidden>{ev.icon}</span> {ev.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
