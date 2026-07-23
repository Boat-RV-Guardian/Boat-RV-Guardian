// Account Information section (Settings → General). Extracted from Settings.tsx as part of the
// Task 3 split. Sign-in CTA / signed-in email + sign-out, cloud-sync + cloud-history toggles (the
// latter gated by the per-vehicle tier), and the startup-vehicle preference. Pure presentational:
// state + handlers come in as props.
//
// Task 15 "migrate local account to the cloud": a local-only user with vehicles gets TWO local→cloud
// options here — the pre-existing "Switch to a cloud account" (rebuild: wipes local, starts fresh) and
// the new "Migrate my vehicles to the cloud" (stages the local vehicles via
// utils/migrateLocalToCloud.ts BEFORE sign-in is triggered, so the forced wipe+reload that follows
// sign-in doesn't lose them — see that module's header comment for the full hazard writeup). Both
// funnel into the same inline Login; the only difference is whether a stash was written first.

import { useState } from 'react';
import Login from '../Login';
import { auth, signOut } from '../../services/firebase';
import type { Vehicle } from '../../utils/VehicleManager';
import { cloudSwitchDiscardNote } from '../../utils/accountMode';
import { stashPendingMigration, clearPendingMigration } from '../../utils/migrateLocalToCloud';

interface UserConfigLike {
  startupMode?: 'default' | 'last';
  activeVehicleId?: string;
}

interface Props {
  user: any;
  /** True when this device is in local-only mode (a synthetic `local:` owner, no Firebase account). */
  localMode: boolean;
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
  const [showMigrateConfirm, setShowMigrateConfirm] = useState(false);
  const localVehicleCount = Object.keys(p.vehiclesMap).length;

  // Rebuild: discard any staged migration (this is the "start fresh" path) then open the inline Login.
  const startRebuildSwitch = () => { clearPendingMigration(localStorage); p.setShowLogin(true); };
  // Migrate: stage every local vehicle BEFORE sign-in is triggered — see migrateLocalToCloud.ts for why
  // this ordering matters (sign-in wipes lt_/sh_ storage + hard-reloads almost immediately after).
  const startMigrate = () => {
    stashPendingMigration(p.vehiclesMap, localStorage);
    setShowMigrateConfirm(false);
    p.setShowLogin(true);
  };
  const cancelLogin = () => { clearPendingMigration(localStorage); p.setShowLogin(false); };

  return (
    <div className="glass-card">
    <h3 style={{ marginTop: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', marginBottom: '16px' }}>Account Information</h3>
    {!p.user ? (
      <div>
        {p.localMode ? (
          <>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
              You’re in <strong>local-only mode</strong> — everything is stored on this device and nothing syncs to the cloud. Switch to a cloud account to enable remote monitoring, cross-device sync, vehicle sharing, and away push notifications.
            </p>
            <p style={{ color: '#f59e0b', fontSize: '0.85rem', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '8px', padding: '10px 12px', margin: '0 0 4px' }}>
              ⚠️ {cloudSwitchDiscardNote(localVehicleCount)}
            </p>
          </>
        ) : (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            Sign in to Boat & RV Guardian to enable remote monitoring, cloud synchronization of your settings, and push notifications when you are away from the local network.
          </p>
        )}
        {!p.showLogin ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px', alignItems: 'flex-start' }}>
            <button className="btn-primary" onClick={startRebuildSwitch}>
              {p.localMode ? 'Switch to a cloud account' : 'Log into your account'}
            </button>
            {p.localMode && localVehicleCount > 0 && (
              <button className="btn-secondary" onClick={() => setShowMigrateConfirm(true)}>
                Migrate my vehicles to the cloud
              </button>
            )}
          </div>
        ) : (
          <div style={{ marginTop: '20px', background: 'rgba(0,0,0,0.2)', padding: '15px', borderRadius: '12px' }}>
            <Login />
            <div style={{ textAlign: 'center', marginTop: '10px' }}>
              <button className="btn-secondary" onClick={cancelLogin} style={{ fontSize: '0.85rem' }}>Cancel</button>
            </div>
          </div>
        )}

        {showMigrateConfirm && (
          <div
            role="dialog"
            aria-label="Migrate my vehicles to the cloud"
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(5px)' }}
          >
            <div className="glass-card" style={{ maxWidth: '420px', width: '90%' }}>
              <h3 style={{ marginTop: 0, color: 'var(--accent-cyan)' }}>Migrate to the cloud</h3>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                You're about to sign into (or create) a cloud account. Once signed in, your {localVehicleCount === 1 ? '1 vehicle' : `${localVehicleCount} vehicles`} stored on this device
                {' '}will be uploaded to that account automatically — nothing is deleted from this device until each vehicle's upload is confirmed.
                Afterward this device switches fully to cloud mode (no hybrid local + cloud vehicles).
              </p>
              <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                <button className="btn-secondary" onClick={() => setShowMigrateConfirm(false)} style={{ flex: 1 }}>Cancel</button>
                <button className="btn-primary" onClick={startMigrate} style={{ flex: 1 }}>Continue</button>
              </div>
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
