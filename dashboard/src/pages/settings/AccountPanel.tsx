// Account Information section (Settings → General). Extracted from Settings.tsx as part of the
// Task 3 split. Sign-in CTA / signed-in email + sign-out, cloud-sync + cloud-history toggles (the
// latter gated by the per-vehicle tier), and the startup-vehicle preference. Pure presentational:
// state + handlers come in as props.

import Login from '../Login';
import { auth, signOut } from '../../services/firebase';
import type { Vehicle } from '../../utils/VehicleManager';

interface UserConfigLike {
  startupMode?: 'default' | 'last';
  activeVehicleId?: string;
}

interface Props {
  user: any;
  showLogin: boolean;
  setShowLogin: (v: boolean) => void;
  syncSettingsCloud: boolean;
  setSyncSettingsCloud: (v: boolean) => void;
  canCloudHistory: boolean;
  storeHistoryCloud: boolean;
  setStoreHistoryCloud: (v: boolean) => void;
  vehiclesMap: Record<string, Vehicle>;
  userConfig: UserConfigLike | null;
  updateUserConfig: (patch: UserConfigLike) => Promise<void> | void;
  defaultVidSaving: boolean;
  setDefaultVidSaving: (v: boolean) => void;
}

export default function AccountPanel(p: Props) {
  return (
    <div className="glass-card">
    <h3 style={{ marginTop: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', marginBottom: '16px' }}>Account Information</h3>
    {!p.user ? (
      <div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
          Sign in to Boat-RV-Guardian to enable remote monitoring, cloud synchronization of your settings, and push notifications when you are away from the local network.
        </p>
        {!p.showLogin ? (
          <button
            className="btn-primary"
            onClick={() => p.setShowLogin(true)}
            style={{ marginTop: '16px' }}
          >
            Log into Boat-RV-Guardian.com
          </button>
        ) : (
          <div style={{ marginTop: '20px', background: 'rgba(0,0,0,0.2)', padding: '15px', borderRadius: '12px' }}>
            <Login />
            <div style={{ textAlign: 'center', marginTop: '10px' }}>
              <button className="btn-secondary" onClick={() => p.setShowLogin(false)} style={{ fontSize: '0.85rem' }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    ) : (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <p style={{ margin: 0 }}><strong>Email:</strong> {p.user.email}</p>
          <button
            className="btn-secondary"
            onClick={() => signOut(auth)}
            style={{ border: '1px solid #ef4444', color: '#ef4444', padding: '4px 12px', fontSize: '0.8rem' }}
          >
            Sign Out
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ display: 'flex', flexDirection: 'column', cursor: 'pointer' }}>
              <span style={{ fontWeight: 600 }}>Sync settings with the cloud</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Automatically backup and restore your configuration</span>
            </label>
            <input type="checkbox" checked={p.syncSettingsCloud} onChange={(e) => p.setSyncSettingsCloud(e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--accent-cyan)' }} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: p.canCloudHistory ? 1 : 0.6 }}>
            <label style={{ display: 'flex', flexDirection: 'column', cursor: p.canCloudHistory ? 'pointer' : 'not-allowed' }}>
              <span style={{ fontWeight: 600 }}>Store historical data in the cloud</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {p.canCloudHistory ? 'Sync your water flow history for long-term storage' : 'Cloud history is a Basic/Premium feature — upgrade to enable.'}
              </span>
            </label>
            <input type="checkbox" disabled={!p.canCloudHistory} checked={p.canCloudHistory && p.storeHistoryCloud} onChange={(e) => p.setStoreHistoryCloud(e.target.checked)} style={{ width: '18px', height: '18px', cursor: p.canCloudHistory ? 'pointer' : 'not-allowed', accentColor: 'var(--accent-cyan)' }} />
          </div>
        </div>

        {/* Startup vehicle: open the last-used vehicle, or always a specific default. */}
        {(() => {
          const vehicles = Object.values(p.vehiclesMap);
          if (vehicles.length === 0) return null;
          const mode = p.userConfig?.startupMode || 'default';
          // Auto-pick the first vehicle if the account has no preference set yet
          const effectiveDefault = p.userConfig?.activeVehicleId || vehicles[0]?.id || '';
          return (
            <div style={{ marginTop: '16px' }}>
              <label className="form-label" style={{ marginBottom: '4px' }}>When the app opens</label>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <select
                    className="form-input"
                    value={mode}
                    onChange={async (e) => {
                      const m = e.target.value as 'default' | 'last';
                      p.setDefaultVidSaving(true);
                      try {
                        await p.updateUserConfig(m === 'default'
                          ? { startupMode: 'default', activeVehicleId: effectiveDefault }
                          : { startupMode: 'last' });
                      } finally { p.setDefaultVidSaving(false); }
                    }}
                  >
                    <option value="last">Last used vehicle</option>
                    <option value="default">A specific vehicle</option>
                  </select>
                </div>
                {mode === 'default' && (
                  <div style={{ flex: 1 }}>
                    <select
                      className="form-input"
                      value={effectiveDefault}
                      onChange={async (e) => {
                        p.setDefaultVidSaving(true);
                        try { await p.updateUserConfig({ startupMode: 'default', activeVehicleId: e.target.value }); }
                        finally { p.setDefaultVidSaving(false); }
                      }}
                    >
                      {vehicles.map(v => (
                        <option key={v.id} value={v.id}>{v.config.lt_vessel_name || v.id}</option>
                      ))}
                    </select>
                  </div>
                )}
                {p.defaultVidSaving && (
                  <span style={{ fontSize: '0.8rem', color: 'var(--accent-cyan)', paddingBottom: '10px', whiteSpace: 'nowrap' }}>Saving…</span>
                )}
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '6px 0 0 0' }}>
                {mode === 'default'
                  ? 'Opens this vehicle every time you log in.'
                  : 'Opens whichever vehicle you used last on this device.'}
              </p>
            </div>
          );
        })()}

      </div>
    )}
  </div>
  );
}
