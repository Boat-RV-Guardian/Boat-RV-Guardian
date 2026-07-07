import Dashboard from './Dashboard';
import Sensors from './Sensors';
import type { SystemsSection } from '../utils/navTargets';

// "Systems" consolidates the former Fresh Water / High Water / Batteries / Shore Power top-level tabs
// into one destination with peer sections (Task 16 IA). The valve is treated like any other sensor —
// it lives under Water alongside the fresh-water devices, not in a privileged tab.
//
// IMPORTANT: the valve (Dashboard → LinkTapWidget) is ALWAYS rendered here (display-toggled by section),
// never conditionally unmounted, because its in-app Flooding Sentry / poll-command state machine must
// keep running regardless of which section (or view) is showing — App keeps this whole component mounted
// (display:none) when another view is active, exactly as the old always-mounted Fresh Water page did.
// The read-only Shelly sensor groups mount only while Systems is the ACTIVE view, so they don't poll in
// the background (the Overview already polls them via its tiles — avoids double-polling).

const SECTIONS: { key: SystemsSection; label: string; icon: string; color: string }[] = [
  { key: 'water', label: 'Water', icon: '💧', color: 'var(--accent-cyan)' },
  { key: 'power', label: 'Power', icon: '🔋', color: '#10b981' },
  { key: 'flood', label: 'Flood', icon: '🚨', color: '#3b82f6' },
];

export default function Systems({ active, section, onSection, onBack }: {
  active: boolean;
  section: SystemsSection;
  onSection: (s: SystemsSection) => void;
  /** Systems is a drill-down from Overview (no nav tab of its own since the merge) — the way back. */
  onBack?: () => void;
}) {
  return (
    <div style={{ padding: '20px 20px 100px', maxWidth: '1100px', margin: '0 auto', color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '0 0 16px' }}>
        {onBack && (
          <button className="btn-secondary" onClick={onBack} aria-label="Back to Overview"
            style={{ padding: '6px 12px', fontSize: '0.85rem', boxShadow: 'none', whiteSpace: 'nowrap' }}>
            ← Overview
          </button>
        )}
        <h2 style={{ fontSize: '2rem', color: 'var(--accent-cyan)', margin: 0 }}>Systems</h2>
      </div>

      <nav style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => onSection(s.key)}
            className={section === s.key ? 'btn-primary' : 'btn-secondary'}
            style={{ padding: '8px 16px', fontSize: '0.9rem', boxShadow: 'none' }}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </nav>

      {/* Water — the valve, ALWAYS mounted (display-toggled), so the Flooding Sentry keeps running. */}
      <div style={{ display: section === 'water' ? 'block' : 'none' }}>
        <Dashboard />
      </div>

      {/* Power + Flood — read-only Shelly sensors; mount only while Systems is the active view. */}
      {active && section === 'power' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Sensors category="batteries" />
          <Sensors category="shore_power" />
        </div>
      )}
      {active && section === 'flood' && <Sensors category="flood" />}
    </div>
  );
}
