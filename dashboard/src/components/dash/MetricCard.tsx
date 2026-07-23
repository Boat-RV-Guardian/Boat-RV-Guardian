import type { ReactNode } from 'react';
import type { TileBadge, TileLevel } from '../../utils/sensorDisplay';

// The Dashboard's core presentational card: icon chip + name + status badge, a big reading, a
// context line, and an optional sparkline/extra footer. Status level tints the border/glow
// (.metric-ok/.metric-warn/.metric-crit in index.css).

export default function MetricCard({ icon, iconColor, title, badge, primary, unit, secondary, level = 'none', onClick, footer, children }: {
  icon: string;
  iconColor: string;
  title: string;
  badge?: TileBadge | null;
  primary: string;
  unit?: string;
  secondary?: string;
  level?: TileLevel;
  onClick?: () => void;
  /** Bottom strip — sparkline, source/updated line, etc. */
  footer?: ReactNode;
  /** Optional extra content between the reading and the footer (e.g. the valve's flow wave). */
  children?: ReactNode;
}) {
  return (
    <div
      className={`metric-card metric-${level}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span className="metric-icon" style={{ background: `${iconColor}1f`, border: `1px solid ${iconColor}44` }}>{icon}</span>
        <span style={{ flex: 1, fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        {badge && <span className="metric-badge" style={{ color: badge.c, background: `${badge.c}1f`, border: `1px solid ${badge.c}55` }}>{badge.t}</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', margin: '10px 0 2px' }}>
        <span style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.02em', color: '#fff', lineHeight: 1 }}>{primary}</span>
        {unit ? <span style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{unit}</span> : null}
      </div>
      {secondary ? <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{secondary}</div> : null}

      {children}
      {footer ? <div style={{ marginTop: 'auto', paddingTop: '10px' }}>{footer}</div> : null}
    </div>
  );
}
