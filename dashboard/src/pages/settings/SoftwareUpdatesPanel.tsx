// Software Updates panel (Settings → Updates). Extracted from Settings.tsx as part of the Task 3
// split. Pure presentational: the current app version + the latest GitHub release come in as props.

interface Props {
  appVersion: string;
  latestVersion: string | null;
}

export default function SoftwareUpdatesPanel({ appVersion, latestVersion }: Props) {
  const updateAvailable = !!latestVersion && latestVersion !== appVersion;
  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <h3 style={{ margin: 0, color: 'var(--accent-cyan)' }}>Software Updates</h3>

      {updateAvailable ? (
        <div style={{ padding: '16px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid var(--accent-emerald)', borderRadius: '12px', textAlign: 'center' }}>
          <div style={{ fontSize: '1.2rem', marginBottom: '8px' }}>🎉 New Update Available!</div>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Version <strong>{latestVersion}</strong> is ready to download.</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>You are currently running v{appVersion}</div>
        </div>
      ) : (
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '16px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
          Current Version: Boat &amp; RV Guardian v{appVersion}
          {latestVersion === appVersion && <div style={{ color: 'var(--accent-cyan)', marginTop: '8px' }}>You are up to date!</div>}
        </div>
      )}

      <a href="https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/releases" target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
        <button className="btn-secondary" style={{ width: '100%', padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '0.9rem', background: updateAvailable ? 'var(--accent-emerald)' : '', color: updateAvailable ? '#fff' : '', borderColor: updateAvailable ? 'var(--accent-emerald)' : '' }}>
          {updateAvailable ? '⬇️ Download Update' : '🔄 Check for Updates on GitHub'}
        </button>
      </a>
    </div>
  );
}
