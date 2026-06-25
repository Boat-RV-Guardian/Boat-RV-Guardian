// Per-device configuration list (Settings → Devices → Configuration). Extracted from Settings.tsx
// as part of the Task 3 split. Devices grouped by category; each row expands to enable/disable,
// firmware (Shelly), Normal Run Profile + Safety Limits (LinkTap), and Shelly local-IP test /
// secure / clear, voltmeter enable + voltage calibration. Pure presentational: all state + the
// device-RPC handlers stay in Settings and pass in as props. JSX is moved verbatim (only the inline
// dynamic-import paths are re-based from `../utils/*` to `../../utils/*`).
//
// NOTE: several inline handlers here perform live device RPC (voltmeter-enable REBOOTS the device,
// SetAuth, firmware update). Behavior is unchanged by this extraction, but changes to those flows
// want a hardware smoke test (see AGENTS.md / docs/TESTING.md).

import type { Dispatch, SetStateAction } from 'react';
import type { DeviceConfig } from '../../utils/VehicleManager';

type DevicePanelMsg = { id: string; text: string; ok: boolean } | null;

interface Props {
  devices: DeviceConfig[];
  setDevices: (v: DeviceConfig[]) => void;
  expandedDeviceId: string | null;
  handleExpandDevice: (deviceId: string) => void;
  setDeviceToRemove: (d: DeviceConfig | null) => void;
  setFactoryResetOnRemove: (v: boolean) => void;
  fwBusy: boolean;
  fwMsg: string;
  handleCheckFirmware: (device: DeviceConfig) => void;
  handleUpdateFirmware: (device: DeviceConfig) => void;
  devNormalHrs: number;
  setDevNormalHrs: (v: number) => void;
  devNormalMins: number;
  setDevNormalMins: (v: number) => void;
  devNormalDaily: boolean;
  setDevNormalDaily: (v: boolean) => void;
  devNormalVol: number;
  setDevNormalVol: (v: number) => void;
  devAutoRestart: boolean;
  setDevAutoRestart: (v: boolean) => void;
  saveDeviceNormalRun: (key: string, value: string | number | boolean) => void;
  volUnit: string;
  unitSystem: 'metric' | 'imperial';
  devicePanelBusy: boolean;
  setDevicePanelBusy: (v: boolean) => void;
  devicePanelMsg: DevicePanelMsg;
  setDevicePanelMsg: (v: DevicePanelMsg) => void;
  deviceLocalHost: (d: DeviceConfig) => string;
  readVoltNow: (device: DeviceConfig) => void;
  voltReadMsg: Record<string, string>;
  offsetDraft: Record<string, string>;
  setOffsetDraft: Dispatch<SetStateAction<Record<string, string>>>;
  applyVoltOffset: (device: DeviceConfig, explicitOff?: number) => void;
}

export default function DeviceConfigPanel({
  devices, setDevices, expandedDeviceId, handleExpandDevice, setDeviceToRemove, setFactoryResetOnRemove,
  fwBusy, fwMsg, handleCheckFirmware, handleUpdateFirmware,
  devNormalHrs, setDevNormalHrs, devNormalMins, setDevNormalMins, devNormalDaily, setDevNormalDaily,
  devNormalVol, setDevNormalVol, devAutoRestart, setDevAutoRestart, saveDeviceNormalRun, volUnit, unitSystem,
  devicePanelBusy, setDevicePanelBusy, devicePanelMsg, setDevicePanelMsg, deviceLocalHost,
  readVoltNow, voltReadMsg, offsetDraft, setOffsetDraft, applyVoltOffset,
}: Props) {
  return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {[
              { label: 'Fresh Water',      icon: '🚰', color: 'var(--accent-cyan)', match: (d: DeviceConfig) => d.type === 'linktap_valve' },
              { label: 'High Water/Flood', icon: '🌊', color: '#3b82f6',            match: (d: DeviceConfig) => d.role === 'Flood Sensor' },
              { label: 'Batteries',        icon: '🔋', color: '#f59e0b',            match: (d: DeviceConfig) => d.role === 'Low Power Sensor' },
              { label: 'Shore Power',      icon: '⚡', color: '#a855f7',            match: (d: DeviceConfig) => d.role === 'High Power Sensor' },
            ].map(({ label, icon, color, match }) => {
              const catDevices = devices.filter(match);
              return (
                <div key={label} className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <h3 style={{ margin: 0, color, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>{icon} {label}</h3>
                  {catDevices.length === 0 ? (
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0 }}>No {label.toLowerCase()} devices configured.</p>
                  ) : catDevices.map(device => (
                    <div key={device.id}>
                      {/* Device row */}
                      <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        background: 'rgba(255,255,255,0.03)', padding: '12px 16px',
                        borderRadius: expandedDeviceId === device.id ? '12px 12px 0 0' : '12px',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderBottom: expandedDeviceId === device.id ? 'none' : undefined,
                      }}>
                        <div style={{ opacity: device.enabled === false ? 0.55 : 1 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {device.name || device.role}
                            {device.enabled === false && (
                              <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Disabled</span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            {device.type === 'linktap_valve' ? '🚰 LinkTap Valve' : '⚡ Shelly Sensor'} · {device.linktapDeviceId || device.shellyDeviceId || device.id}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            className={expandedDeviceId === device.id ? 'btn-primary' : 'btn-secondary'}
                            onClick={() => handleExpandDevice(device.id)}
                            title="Device Settings"
                            style={{ padding: '6px 10px', fontSize: '1.1rem', lineHeight: 1 }}
                          >⚙️</button>
                          <button
                            className="btn-secondary"
                            onClick={() => { setDeviceToRemove(device); setFactoryResetOnRemove(false); }}
                            style={{ padding: '6px 10px', fontSize: '0.75rem', borderColor: '#ef4444', color: '#ef4444' }}
                          >Remove</button>
                        </div>
                      </div>

                      {/* Expanded settings panel */}
                      {expandedDeviceId === device.id && (
                        <div style={{
                          background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.1)',
                          borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '16px',
                          display: 'flex', flexDirection: 'column', gap: '16px',
                        }}>
                          {/* Enable / disable — gates polling and startup auto-connect */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '12px 14px' }}>
                            <div>
                              <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>Device Enabled</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                When off, this device isn't polled and is skipped on startup auto-connect.
                              </div>
                            </div>
                            <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                              <input type="checkbox" checked={device.enabled !== false}
                                onChange={(e) => { import('../../utils/VehicleManager').then(m => { m.updateDevice(device.id, { enabled: e.target.checked }); setDevices(m.getDevices()); }); }}
                                style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: 'var(--accent-emerald)' }} />
                            </label>
                          </div>

                          {/* Firmware (Shelly devices) */}
                          {device.type === 'shelly_sensor' && (
                            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                <div>
                                  <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>Firmware</div>
                                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                    {device.fwVersion ? `Current: v${device.fwVersion}` : 'Version unknown — check below.'}
                                    {device.fwUpdateVersion ? `  •  ⬆️ v${device.fwUpdateVersion} available` : ''}
                                  </div>
                                </div>
                                <button className="btn-secondary" disabled={fwBusy} onClick={() => handleCheckFirmware(device)}
                                  style={{ padding: '6px 12px', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                                  {fwBusy ? '…' : 'Check for Update'}
                                </button>
                              </div>
                              {device.fwUpdateVersion && (
                                <button className="btn-primary" disabled={fwBusy} onClick={() => handleUpdateFirmware(device)}
                                  style={{ padding: '8px 12px', fontSize: '0.82rem' }}>
                                  ⬆️ Update Firmware to v{device.fwUpdateVersion}
                                </button>
                              )}
                              {fwMsg && expandedDeviceId === device.id && (
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{fwMsg}</div>
                              )}
                            </div>
                          )}

                          {device.type === 'linktap_valve' && (
                            <>
                              {/* Normal Run Profile */}
                              <div style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '8px', padding: '14px' }}>
                                <h4 style={{ margin: '0 0 12px 0', color: 'var(--accent-emerald)', fontSize: '0.95rem', fontWeight: 700 }}>Normal Run Profile</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                  <div>
                                    <label className="form-label">Duration</label>
                                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                      <input type="number" min="0" max="23" disabled={devNormalDaily} className="form-input"
                                        value={devNormalHrs}
                                        onChange={(e) => { const v = Math.min(23, Math.max(0, Number(e.target.value))); setDevNormalHrs(v); saveDeviceNormalRun('lt_norm_hrs', v); }}
                                        style={{ width: '40%', padding: '8px', opacity: devNormalDaily ? 0.5 : 1 }} />
                                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>hrs</span>
                                      <input type="number" min="0" max="59" disabled={devNormalDaily} className="form-input"
                                        value={devNormalMins}
                                        onChange={(e) => { const v = Math.min(59, Math.max(0, Number(e.target.value))); setDevNormalMins(v); saveDeviceNormalRun('lt_norm_mins', v); }}
                                        style={{ width: '40%', padding: '8px', opacity: devNormalDaily ? 0.5 : 1 }} />
                                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>mins</span>
                                    </div>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px', cursor: 'pointer' }}>
                                      <input type="checkbox" checked={devNormalDaily}
                                        onChange={(e) => { setDevNormalDaily(e.target.checked); saveDeviceNormalRun('lt_norm_daily', e.target.checked); }}
                                        style={{ width: '16px', height: '16px', accentColor: 'var(--accent-cyan)' }} />
                                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Daily (run once per day)</span>
                                    </label>
                                  </div>
                                  <div>
                                    <label className="form-label">Volume Limit ({volUnit})</label>
                                    <input type="number" min="1" className="form-input" value={devNormalVol}
                                      onChange={(e) => { const v = Math.max(1, Number(e.target.value)); setDevNormalVol(v); saveDeviceNormalRun('lt_norm_vol', v); }} />
                                  </div>
                                </div>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', cursor: 'pointer' }}>
                                  <input type="checkbox" checked={devAutoRestart}
                                    onChange={(e) => { setDevAutoRestart(e.target.checked); saveDeviceNormalRun('lt_auto_restart', e.target.checked); }}
                                    style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--accent-cyan)' }} />
                                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Auto-restart profile automatically when time expires</span>
                                </label>
                              </div>

                              {/* Safety Limits */}
                              <div>
                                <h4 style={{ margin: '0 0 10px 0', color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: 600 }}>Safety Limits</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                  <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Max Flow Speed Limit</span>
                                      <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>{device.maxFlowRate || 15} {unitSystem === 'metric' ? 'L/min' : 'Gal/min'}</span>
                                    </div>
                                    <input type="range" min="5" max="35" className="form-input" style={{ padding: 0 }}
                                      value={device.maxFlowRate || 15}
                                      onChange={(e) => { import('../../utils/VehicleManager').then(m => { m.updateDevice(device.id, { maxFlowRate: Number(e.target.value) }); setDevices(m.getDevices()); }); }} />
                                  </div>
                                  <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Max Continuous Open</span>
                                      <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>{device.maxDuration || 30} Mins</span>
                                    </div>
                                    <input type="range" min="5" max="120" className="form-input" style={{ padding: 0 }}
                                      value={device.maxDuration || 30}
                                      onChange={(e) => { import('../../utils/VehicleManager').then(m => { m.updateDevice(device.id, { maxDuration: Number(e.target.value) }); setDevices(m.getDevices()); }); }} />
                                  </div>
                                </div>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', cursor: 'pointer' }}>
                                  <input type="checkbox" checked={device.autoGuardEnabled !== false}
                                    onChange={(e) => { import('../../utils/VehicleManager').then(m => { m.updateDevice(device.id, { autoGuardEnabled: e.target.checked }); setDevices(m.getDevices()); }); }}
                                    style={{ width: '16px', height: '16px', accentColor: 'var(--accent-cyan)', cursor: 'pointer' }} />
                                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Enable Auto-Guard Flooding Sentry for this valve</span>
                                </label>
                              </div>
                            </>
                          )}

                          {device.type === 'shelly_sensor' && (
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                              <div><strong style={{ color: '#fff' }}>Device ID:</strong> {device.shellyDeviceId}</div>
                              <div><strong style={{ color: '#fff' }}>Role:</strong> {device.role}</div>

                              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                                <span>🔋 Battery-powered (don't poll — alerts via push)</span>
                                <input type="checkbox" checked={device.batteryPowered !== false && (device.batteryPowered === true || device.role === 'Flood Sensor')}
                                  onChange={(e) => { import('../../utils/VehicleManager').then(m => { m.updateDevice(device.id, { batteryPowered: e.target.checked }); setDevices(m.getDevices()); }); }}
                                  style={{ width: '16px', height: '16px', accentColor: 'var(--accent-cyan)' }} />
                              </label>

                              <div>
                                <label className="form-label" style={{ marginBottom: '4px' }}>Local IP Address</label>
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 6px 0' }}>
                                  Set this so the app can poll the device directly on your network (faster than cloud).
                                </p>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <input
                                    className="form-input"
                                    placeholder="e.g. 192.168.1.50"
                                    defaultValue={device.localIp || ''}
                                    onBlur={(e) => { import('../../utils/VehicleManager').then(m => { m.updateDevice(device.id, { localIp: e.target.value.trim() }); setDevices(m.getDevices()); }); }}
                                    style={{ flex: 1 }}
                                  />
                                  <button
                                    className="btn-secondary"
                                    disabled={devicePanelBusy || !device.localIp}
                                    style={{ padding: '6px 12px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                                    onClick={async () => {
                                      setDevicePanelBusy(true); setDevicePanelMsg(null);
                                      try {
                                        const { shellyRpc } = await import('../../utils/shellyRpc');
                                        const info = await shellyRpc(device.localIp!, 'Shelly.GetDeviceInfo', {}, localStorage.getItem('sh_local_password') || undefined);
                                        setDevicePanelMsg({ id: device.id, text: `✓ Reachable — ${info?.model || info?.app || info?.id || 'Shelly'}`, ok: true });
                                      } catch (err: any) {
                                        setDevicePanelMsg({ id: device.id, text: `✗ ${err?.message || 'Unreachable'}`, ok: false });
                                      } finally { setDevicePanelBusy(false); }
                                    }}
                                  >Test</button>
                                </div>
                              </div>

                              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                <button
                                  className="btn-secondary"
                                  disabled={devicePanelBusy || !device.localIp || !device.shellyDeviceId}
                                  style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                                  onClick={async () => {
                                    setDevicePanelBusy(true); setDevicePanelMsg(null);
                                    try {
                                      const { shellySetPassword } = await import('../../utils/shellyRpc');
                                      const pw = localStorage.getItem('sh_local_password') || '';
                                      if (!pw) throw new Error('No vehicle password set');
                                      await shellySetPassword(device.localIp!, device.shellyDeviceId!, pw);
                                      setDevicePanelMsg({ id: device.id, text: '✓ Device secured with the vehicle password.', ok: true });
                                    } catch (err: any) {
                                      setDevicePanelMsg({ id: device.id, text: `✗ ${err?.message || 'Failed'}`, ok: false });
                                    } finally { setDevicePanelBusy(false); }
                                  }}
                                >🔒 Secure with vehicle password</button>
                                <button
                                  className="btn-secondary"
                                  disabled={devicePanelBusy || !device.localIp}
                                  style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                                  onClick={async () => {
                                    setDevicePanelBusy(true); setDevicePanelMsg(null);
                                    try {
                                      const { shellyClearPassword } = await import('../../utils/shellyRpc');
                                      await shellyClearPassword(device.localIp!, localStorage.getItem('sh_local_password') || '');
                                      setDevicePanelMsg({ id: device.id, text: '✓ Password cleared.', ok: true });
                                    } catch (err: any) {
                                      setDevicePanelMsg({ id: device.id, text: `✗ ${err?.message || 'Failed'}`, ok: false });
                                    } finally { setDevicePanelBusy(false); }
                                  }}
                                >Clear password</button>
                              </div>

                              {/* Shelly Plus Uni's 0-30 V voltmeter isn't enabled by default — it must be
                                  linked as a peripheral (creates voltmeter:1xx; reboots the device).
                                  Provisioning does this automatically; this re-runs it for devices added
                                  before the fix or after a factory reset. */}
                              {device.role === 'Low Power Sensor' && (
                                <div>
                                  <button
                                    className="btn-secondary"
                                    disabled={devicePanelBusy || !deviceLocalHost(device)}
                                    style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                                    onClick={async () => {
                                      const host = deviceLocalHost(device);
                                      if (!host) return;
                                      setDevicePanelBusy(true); setDevicePanelMsg(null);
                                      try {
                                        const { shellyRpc, enableShellyVoltmeter } = await import('../../utils/shellyRpc');
                                        const pw = localStorage.getItem('sh_local_password') || undefined;
                                        const { id, rebooted } = await enableShellyVoltmeter((m, p) => shellyRpc(host, m, p, pw));
                                        setDevicePanelMsg(id != null
                                          ? { id: device.id, text: rebooted
                                              ? `✓ Voltmeter enabled (voltmeter:${id}) — device rebooting (~15 s), then voltage appears.`
                                              : `✓ Voltmeter already enabled (voltmeter:${id}).`, ok: true }
                                          : { id: device.id, text: '✗ Could not enable the voltmeter — this device may not expose one.', ok: false });
                                      } catch (err: any) {
                                        setDevicePanelMsg({ id: device.id, text: `✗ ${err?.message || 'Unreachable'}${device.batteryPowered ? ' — wake the device and retry' : ''}`, ok: false });
                                      } finally { setDevicePanelBusy(false); }
                                    }}
                                  >🔌 Enable voltmeter</button>
                                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                                    For Shelly Plus Uni battery monitors reading 0.00 V — links the 0-30 V voltmeter peripheral (reboots the device).
                                  </p>
                                </div>
                              )}

                              {/* Voltage calibration — a single offset written ONTO the device (Voltmeter
                                  xvoltage), so local + cloud both report the corrected value. */}
                              {device.role === 'Low Power Sensor' && (
                                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '12px' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <strong style={{ color: '#fff', fontSize: '0.85rem' }}>🎯 Voltage calibration</strong>
                                    <button className="btn-secondary" disabled={devicePanelBusy || !deviceLocalHost(device)}
                                      style={{ padding: '4px 10px', fontSize: '0.72rem' }} onClick={() => readVoltNow(device)}>
                                      🔄 Read now{voltReadMsg[device.id] ? `: ${voltReadMsg[device.id]}` : ''}
                                    </button>
                                  </div>
                                  <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '4px 0 8px 0' }}>
                                    Correction offset for the Shelly Plus Uni voltmeter, written to the device — so the app and the cloud both read the corrected voltage. Offset = (true voltage) − (device reading). Set 0 to clear.
                                  </p>
                                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <div style={{ position: 'relative', width: '140px' }}>
                                      <input className="form-input" type="number" step="0.01" placeholder="e.g. 0.32"
                                        value={offsetDraft[device.id] ?? (device.voltCalOffset != null ? String(device.voltCalOffset) : '')}
                                        onChange={(e) => setOffsetDraft((prev) => ({ ...prev, [device.id]: e.target.value }))}
                                        style={{ paddingRight: '28px' }} />
                                      <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: 'var(--text-secondary)', pointerEvents: 'none' }}>V</span>
                                    </div>
                                    <button className="btn-primary" disabled={devicePanelBusy} style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => applyVoltOffset(device)}>Apply</button>
                                    <button className="btn-secondary" disabled={devicePanelBusy} style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                                      onClick={() => { setOffsetDraft((prev) => ({ ...prev, [device.id]: '0' })); applyVoltOffset(device, 0); }}>Clear</button>
                                  </div>
                                </div>
                              )}

                              {devicePanelMsg?.id === device.id && (
                                <div style={{ fontSize: '0.8rem', color: devicePanelMsg.ok ? '#10b981' : '#ef4444' }}>{devicePanelMsg.text}</div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}

            {devices.length === 0 && (
              <div className="glass-card" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-secondary)' }}>
                No devices configured. Go to "+ Add a device" to get started.
              </div>
            )}
          </div>
  );
}
