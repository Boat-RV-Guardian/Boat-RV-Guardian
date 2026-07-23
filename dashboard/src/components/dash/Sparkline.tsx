import { useId } from 'react';

// Dependency-free SVG area sparkline for the Dashboard metric cards.

/** Line + closed-area SVG path strings for a series normalized into a w×h box. */
export function sparkPaths(values: number[], w: number, h: number, pad = 2): { line: string; area: string } {
  if (values.length < 2) return { line: '', area: '' };
  let min = Math.min(...values), max = Math.max(...values);
  if (max - min < 1e-9) { min -= 0.5; max += 0.5; } // flat series → centered line
  const span = max - min;
  const stepX = (w - pad * 2) / (values.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / span) * (h - pad * 2);
  const pts = values.map((v, i) => `${(pad + i * stepX).toFixed(2)},${y(v).toFixed(2)}`);
  const line = `M${pts.join(' L')}`;
  const area = `${line} L${(pad + (values.length - 1) * stepX).toFixed(2)},${h} L${pad},${h} Z`;
  return { line, area };
}

export default function Sparkline({ values, color, height = 38 }: { values: number[]; color: string; height?: number }) {
  const id = useId();
  const W = 200, H = 44;
  const { line, area } = sparkPaths(values, W, H);
  if (!line) return null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: `${height}px`, display: 'block' }} aria-hidden="true">
      <defs>
        <linearGradient id={`sg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
