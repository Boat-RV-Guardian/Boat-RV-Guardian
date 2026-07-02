// Software Updates panel (Settings → Updates). Extracted from Settings.tsx as part of the Task 3
// split. Pure presentational: the current app version + the latest GitHub release come in as props.
//
// Task 13 part 3: `tauriUpdate` (from useAppUpdater) carries the REAL signed-update flow on Tauri
// desktop — when it has something actionable (an update found, downloading, installed, or a failed
// INSTALL attempt), this renders that instead of the plain GitHub-releases link. A failed background
// *check* ('error') is deliberately NOT shown here: until the release pipeline has published its first
// real update manifest (#52), every check fails by definition (no latest.json exists yet), so an
// alarming red error would be noise, not information — confirmed live via a native install where "up
// to date" (the real signal, from the pre-existing GitHub-tag check) rendered correctly alongside a
// since-removed "Update check failed" line that added nothing. A failed *install* ('install-error') IS
// shown — the user just clicked a button, so silently doing nothing would look like a hang. On every
// other platform (web, Capacitor/Android) or before the check resolves, the original
// appVersion/latestVersion badge + GitHub link is the only thing shown — unchanged from before this
// feature existed.
import type { UseAppUpdater } from '../../hooks/useAppUpdater';

interface Props {
  appVersion: string;
  latestVersion: string | null;
  tauriUpdate?: UseAppUpdater;
}

export default function SoftwareUpdatesPanel({ appVersion, latestVersion, tauriUpdate }: Props) {
  const updateAvailable = !!latestVersion && latestVersion !== appVersion;
  const t = tauriUpdate;
  const tauriActionable = !!t && (t.status === 'available' || t.status === 'downloading' || t.status === 'ready' || t.status === 'install-error');

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

      {tauriActionable && t ? (
        <>
          {t.status === 'available' && (
            <button className="btn-secondary" onClick={t.installUpdate} style={{ width: '100%', padding: '12px', fontSize: '0.9rem', background: 'var(--accent-emerald)', color: '#fff', borderColor: 'var(--accent-emerald)' }}>
              ⬇️ Download &amp; Install v{t.version}
            </button>
          )}
          {t.status === 'downloading' && (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '12px' }}>{t.progressText}</div>
          )}
          {t.status === 'ready' && (
            <div style={{ fontSize: '0.85rem', color: 'var(--accent-emerald)', textAlign: 'center', padding: '12px' }}>{t.progressText}</div>
          )}
          {t.status === 'install-error' && (
            <div style={{ fontSize: '0.8rem', color: '#ef4444', textAlign: 'center' }}>Update install failed: {t.error}</div>
          )}
        </>
      ) : (
        <a href="https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/releases" target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
          <button className="btn-secondary" style={{ width: '100%', padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '0.9rem', background: updateAvailable ? 'var(--accent-emerald)' : '', color: updateAvailable ? '#fff' : '', borderColor: updateAvailable ? 'var(--accent-emerald)' : '' }}>
            {updateAvailable ? '⬇️ Download Update' : '🔄 Check for Updates on GitHub'}
          </button>
        </a>
      )}
    </div>
  );
}
