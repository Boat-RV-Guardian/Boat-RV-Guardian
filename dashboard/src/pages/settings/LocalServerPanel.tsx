// Local Server options panel (Settings → Vehicles). Extracted from Settings.tsx as part of the
// Task 3 split. Pure presentational: state + persistence stay in Settings; this takes value/onChange.

interface Props {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  background: boolean;
  onBackgroundChange: (v: boolean) => void;
}

export default function LocalServerPanel({ enabled, onEnabledChange, background, onBackgroundChange }: Props) {
  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <h3 style={{ marginTop: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', margin: 0 }}>📡 Local Server</h3>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
        This device can run a local listener so battery sensors (e.g. flood) push alerts straight to it over your LAN — works with no internet, no Bluetooth required.
      </p>
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', cursor: 'pointer' }}>
        <span>
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Enable local sensor server</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Listen for local sensor webhooks on this device.</div>
        </span>
        <input type="checkbox" checked={enabled} onChange={e => onEnabledChange(e.target.checked)} style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: 'var(--accent-emerald)' }} />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.5 }}>
        <span>
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Run in the background</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Keep the server alive when the app is closed so local alerts arrive even offline. On Android this runs a foreground service with a persistent notification and uses more battery. When off, the local server only runs while the app is open.</div>
        </span>
        <input type="checkbox" disabled={!enabled} checked={background} onChange={e => onBackgroundChange(e.target.checked)} style={{ width: '20px', height: '20px', cursor: enabled ? 'pointer' : 'not-allowed', accentColor: 'var(--accent-emerald)' }} />
      </label>
    </div>
  );
}
