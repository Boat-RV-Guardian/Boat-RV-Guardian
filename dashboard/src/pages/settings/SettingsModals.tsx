// Confirmation/entry dialogs for Settings (Remove Device, New Vehicle, Stop-local-server-on-switch,
// Change local password, Delete Vehicle). Extracted from Settings.tsx as part of the Task 3 split.
// Pure presentational: each dialog's open flag, state, and confirm/cancel handlers come in as props.
// The provisioning modals (ProvisionShelly/ProvisionLinkTap) stay in Settings — they own no shared shell.

import type { ReactNode } from 'react';
import type { DeviceConfig } from '../../utils/VehicleManager';

// Shared full-screen blurred overlay all five dialogs use.
function ModalOverlay({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(5px)' }}>
      {children}
    </div>
  );
}

interface Props {
  // Remove Device confirmation
  deviceToRemove: DeviceConfig | null;
  factoryResetOnRemove: boolean;
  setFactoryResetOnRemove: (v: boolean) => void;
  removingDevice: boolean;
  onCancelRemoveDevice: () => void;
  onConfirmRemoveDevice: () => void;
  // New Vehicle
  showNewVehicleModal: boolean;
  newVehicleNameInput: string;
  setNewVehicleNameInput: (v: string) => void;
  newVehicleType: '' | 'boat' | 'rv';
  setNewVehicleType: (v: 'boat' | 'rv') => void;
  onCancelNewVehicle: () => void;
  onConfirmNewVehicle: () => void;
  // Switch vehicle while local server runs
  pendingSwitchVid: string | null;
  onCancelSwitch: () => void;
  onConfirmSwitch: () => void;
  // Change Shelly local password
  showPwChangeModal: boolean;
  pwChangeBusy: boolean;
  onCancelPwChange: () => void;
  onConfirmPwChange: () => void;
  // Delete Vehicle
  showDeleteModal: boolean;
  vesselNickname: string;
  deleteConfirmChecked: boolean;
  setDeleteConfirmChecked: (v: boolean) => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

export default function SettingsModals(p: Props) {
  return (
    <>
      {/* Remove Device confirmation */}
      {p.deviceToRemove && (
        <ModalOverlay>
          <div className="glass-card" style={{ maxWidth: '420px', width: '90%' }}>
            <h3 style={{ marginTop: 0, color: '#ef4444' }}>Remove Device</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Remove <strong>{p.deviceToRemove.name || p.deviceToRemove.role}</strong> from this vehicle? It will no longer be monitored in the app.
            </p>

            {p.deviceToRemove.type === 'shelly_sensor' && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '8px', padding: '12px', marginTop: '8px' }}>
                <input type="checkbox" checked={p.factoryResetOnRemove} onChange={(e) => p.setFactoryResetOnRemove(e.target.checked)} style={{ marginTop: '2px', accentColor: 'var(--accent-cyan)' }} />
                <span style={{ fontSize: '0.82rem' }}>
                  <strong>Also factory reset the device</strong> — erases its Wi-Fi credentials and settings so it can be set up fresh.
                  {!p.deviceToRemove.localIp && <span style={{ display: 'block', color: '#fde68a', marginTop: '4px' }}>⚠️ This device's local IP isn't known, so the reset signal can't be sent. It will only be removed from the app.</span>}
                  {p.deviceToRemove.localIp && <span style={{ display: 'block', color: 'var(--text-muted)', marginTop: '4px' }}>Requires being on the same Wi-Fi network as the device.</span>}
                </span>
              </label>
            )}

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button className="btn-secondary" onClick={p.onCancelRemoveDevice} style={{ flex: 1 }} disabled={p.removingDevice}>Cancel</button>
              <button className="btn-primary" onClick={p.onConfirmRemoveDevice} style={{ flex: 1, background: '#ef4444', borderColor: '#ef4444' }} disabled={p.removingDevice}>
                {p.removingDevice ? 'Removing…' : (p.factoryResetOnRemove && p.deviceToRemove.localIp ? 'Reset & Remove' : 'Remove')}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* New Vehicle Modal */}
      {p.showNewVehicleModal && (
        <ModalOverlay>
          <div className="glass-card" style={{ maxWidth: '400px', width: '90%' }}>
            <h3 style={{ marginTop: 0, color: 'var(--accent-cyan)' }}>Add New Vehicle</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              What would you like to call this new vehicle?
            </p>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. Tow Truck, Main Boat..."
              value={p.newVehicleNameInput}
              onChange={(e) => p.setNewVehicleNameInput(e.target.value)}
              autoFocus
            />
            <label className="form-label" style={{ marginTop: '16px', display: 'block' }}>Type</label>
            <div style={{ display: 'flex', gap: '10px' }}>
              {([['boat', '🚤', 'Boat'], ['rv', '🚐', 'RV']] as const).map(([val, emoji, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => p.setNewVehicleType(val)}
                  style={{
                    flex: 1, padding: '12px', borderRadius: '10px', cursor: 'pointer', color: '#fff',
                    border: p.newVehicleType === val ? '2px solid var(--accent-cyan)' : '1px solid rgba(255,255,255,0.15)',
                    background: p.newVehicleType === val ? 'rgba(0,242,254,0.12)' : 'rgba(255,255,255,0.04)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                  }}
                >
                  <span style={{ fontSize: '1.5rem' }}>{emoji}</span>{label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button className="btn-secondary" onClick={p.onCancelNewVehicle} style={{ flex: 1 }}>Cancel</button>
              <button className="btn-primary" onClick={p.onConfirmNewVehicle} style={{ flex: 1 }} disabled={!p.newVehicleNameInput.trim() || !p.newVehicleType}>Create</button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Switching vehicles while the local server runs — confirm it will be stopped */}
      {p.pendingSwitchVid && (
        <ModalOverlay>
          <div className="glass-card" style={{ maxWidth: '420px', width: '90%' }}>
            <h3 style={{ marginTop: 0, color: '#f59e0b' }}>Stop the local server?</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              The on-device local sensor server is running for this vehicle. Switching vehicles will
              <strong> stop it</strong> — sleepy Shelly sensors won't be able to push events to this
              device until you turn it back on. Continue?
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button className="btn-secondary" onClick={p.onCancelSwitch} style={{ flex: 1 }}>Cancel</button>
              <button className="btn-primary" onClick={p.onConfirmSwitch}
                style={{ flex: 1, background: '#f59e0b', borderColor: '#f59e0b' }}>
                Stop &amp; switch
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Shelly Local Password change confirmation */}
      {p.showPwChangeModal && (
        <ModalOverlay>
          <div className="glass-card" style={{ maxWidth: '440px', width: '90%' }}>
            <h3 style={{ marginTop: 0, color: '#f59e0b' }}>Change local password?</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Are you sure you want to change the local password? This pushes the new password to every
              Shelly device on this vehicle. <strong style={{ color: '#ffb3b3' }}>If it fails, a device can
              become unavailable and might need to be factory reset and re-paired.</strong>
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              <button className="btn-secondary" disabled={p.pwChangeBusy} onClick={p.onCancelPwChange} style={{ flex: 1 }}>Cancel</button>
              <button className="btn-primary" disabled={p.pwChangeBusy} onClick={p.onConfirmPwChange}
                style={{ flex: 1, background: '#f59e0b', borderColor: '#f59e0b' }}>
                {p.pwChangeBusy ? 'Updating…' : 'Yes, change it'}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Delete Vehicle Modal */}
      {p.showDeleteModal && (
        <ModalOverlay>
          <div className="glass-card" style={{ maxWidth: '400px', width: '90%' }}>
            <h3 style={{ marginTop: 0, color: '#ef4444' }}>Delete Vehicle</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Are you sure you want to delete <strong>{p.vesselNickname || 'this vehicle'}</strong>? This action cannot be undone.
            </p>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', background: 'rgba(239, 68, 68, 0.1)', padding: '12px', borderRadius: '8px', cursor: 'pointer', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
              <input
                type="checkbox"
                checked={p.deleteConfirmChecked}
                onChange={(e) => p.setDeleteConfirmChecked(e.target.checked)}
                style={{ marginTop: '2px', width: '18px', height: '18px', accentColor: '#ef4444' }}
              />
              <span style={{ fontSize: '0.85rem', color: '#ffb3b3' }}>
                I understand that all account information and device data for this vehicle will be permanently deleted.
              </span>
            </label>

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button className="btn-secondary" onClick={p.onCancelDelete} style={{ flex: 1 }}>Cancel</button>
              <button
                className="btn-primary"
                onClick={p.onConfirmDelete}
                style={{ flex: 1, background: '#ef4444', borderColor: '#ef4444' }}
                disabled={!p.deleteConfirmChecked}
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </>
  );
}
