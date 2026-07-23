import { useState } from 'react';
import { tileCanvas } from '../../utils/vehicleLocation';

// Dependency-free OSM mini-map: a fixed grid of standard OSM tiles shifted so the position sits at
// the container center, darkened to match the theme with a CSS filter (.map-dark in index.css).
// CSP note: tauri.conf.json img-src already allows https:, so tiles load in the native app too.

export const MIN_ZOOM = 4;
export const MAX_ZOOM = 17;

export default function MiniMap({ lat, lon, zoom, onZoom }: {
  lat: number; lon: number; zoom: number; onZoom?: (z: number) => void;
}) {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  const { tiles, offsetX, offsetY, width, height } = tileCanvas(lat, lon, z);
  const [failed, setFailed] = useState(0); // count of tiles that failed to load (offline)
  const offline = failed > tiles.length / 2;

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 10', overflow: 'hidden', borderRadius: '12px', background: '#0a1428', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="map-dark" style={{ position: 'absolute', left: '50%', top: '50%', width: `${width}px`, height: `${height}px`, transform: `translate(${-offsetX}px, ${-offsetY}px)` }}>
        {tiles.map((t) => (
          <img
            key={t.url}
            src={t.url}
            alt=""
            draggable={false}
            onError={() => setFailed((n) => n + 1)}
            style={{ position: 'absolute', left: `${t.left}px`, top: `${t.top}px`, width: '256px', height: '256px', userSelect: 'none' }}
          />
        ))}
      </div>

      {/* Marker: pulsing vehicle dot at the container center */}
      <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}>
        <div className="map-marker-ring" />
        <div className="map-marker-dot" />
      </div>

      {offline && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(4,8,20,0.55)', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
          Map tiles unavailable offline
        </div>
      )}

      {onZoom && (
        <div style={{ position: 'absolute', right: '8px', top: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <button aria-label="Zoom in" className="map-zoom-btn" disabled={z >= MAX_ZOOM} onClick={() => onZoom(z + 1)}>+</button>
          <button aria-label="Zoom out" className="map-zoom-btn" disabled={z <= MIN_ZOOM} onClick={() => onZoom(z - 1)}>−</button>
        </div>
      )}

      <span style={{ position: 'absolute', right: '6px', bottom: '4px', fontSize: '0.58rem', color: 'rgba(255,255,255,0.55)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
        © OpenStreetMap
      </span>
    </div>
  );
}
