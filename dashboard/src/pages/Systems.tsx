import Dashboard from './Dashboard';
import Home from './Home';
import Sensors from './Sensors';
import { sectionForCategory, type SystemsSection } from '../utils/navTargets';

// "Systems" is the FIRST primary destination (owner restructure 2026-07-22): its sub-pages are
// Dashboard (the former top-level "Overview" tiles page) / Water / Power / Flood / Climate. The
// valve is treated like any other sensor — it lives under Water, not in a privileged tab.
//
// IMPORTANT: the valve (Dashboard.tsx → LinkTapWidget) is ALWAYS rendered here (display-toggled by
// section), never conditionally unmounted, because its in-app Flooding Sentry / poll-command state
// machine must keep running regardless of which section (or view) is showing — App keeps this whole
// component mounted (display:none) when another view is active, exactly as the old always-mounted
// Fresh Water page did. (Naming note: pages/Dashboard.tsx is the VALVE page, a name it has kept from
// the original app; the "Dashboard" SECTION below renders pages/Home.tsx, the tiles page.)
// The read-only Shelly groups + the Dashboard tiles mount only while their section is visible, so
// they don't poll in the background.

const SECTIONS: { key: SystemsSection; label: string; icon: string; color: string }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: '📊', color: 'var(--accent-cyan)' },
  { key: 'water', label: 'Water', icon: '💧', color: 'var(--accent-cyan)' },
  { key: 'power', label: 'Power', icon: '🔋', color: '#10b981' },
  { key: 'flood', label: 'Flood', icon: '🚨', color: '#3b82f6' },
  { key: 'environment', label: 'Climate', icon: '🌡️', color: '#a78bfa' },
];

export default function Systems({ active, section, onSection }: {
  active: boolean;
  section: SystemsSection;
  onSection: (s: SystemsSection) => void;
}) {
  return (
    <div style={{ padding: '20px 20px 100px', maxWidth: '1100px', margin: '0 auto', color: '#fff' }}>
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

      {/* Dashboard — the tiles page (former Overview); its cards drill into the sections below. */}
      {active && section === 'dashboard' && (
        <Home onNavigate={(cat) => onSection(sectionForCategory(cat))} />
      )}

      {/* Water — the valve, ALWAYS mounted (display-toggled), so the Flooding Sentry keeps running. */}
      <div style={{ display: section === 'water' ? 'block' : 'none' }}>
        <Dashboard />
      </div>

      {/* Power + Flood + Climate — read-only Shelly sensors; mount only while visible. */}
      {active && section === 'power' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Sensors category="batteries" />
          <Sensors category="shore_power" />
        </div>
      )}
      {active && section === 'flood' && <Sensors category="flood" />}
      {active && section === 'environment' && <Sensors category="environment" />}
    </div>
  );
}
