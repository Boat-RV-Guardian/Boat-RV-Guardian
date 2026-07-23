// Vehicles section (Settings → General). Extracted from Settings.tsx as part of the Task 3 split.
// Active-vehicle picker + switch/new, nickname edit, Shelly local-password edit flow, collapsible
// Advanced Vehicle Settings (custom cloud server URL/user/key), and Force Cloud Sync. Pure
// presentational: all state + handlers come in as props; the password-change confirm dialog itself
// lives in SettingsModals and is triggered via onRequestSaveShellyPw.

import { useState } from 'react';
import PlanBadge from './PlanBadge';
import { DEFAULT_WORKER_URL } from '../../utils/configSync';
import type { Vehicle } from '../../utils/VehicleManager';

type Msg = { text: string; type: 'success' | 'error' } | null;

interface Props {
  selectedVid: string;
  setSelectedVid: (v: string) => void;
  vehiclesMap: Record<string, Vehicle>;
  activeVid: string;
  onSwitchVehicle: (vid: string) => void;
  onAddNewVehicle: () => void;
  isEditingName: boolean;
  setIsEditingName: (v: boolean) => void;
  vesselNickname: string;
  setVesselNickname: (v: string) => void;
  vehicleType: '' | 'boat' | 'rv';
  onChangeVehicleType: (t: 'boat' | 'rv') => void;
  isEditingType: boolean;
  setIsEditingType: (v: boolean) => void;
  showShellyPw: boolean;
  setShowShellyPw: (v: boolean) => void;
  isEditingShellyPw: boolean;
  setIsEditingShellyPw: (v: boolean) => void;
  shellyPwDraft: string;
  setShellyPwDraft: (v: string) => void;
  shellyLocalPassword: string;
  pwChangeMsg: { ok: boolean; text: string } | null;
  setPwChangeMsg: (v: { ok: boolean; text: string } | null) => void;
  onStartEditShellyPw: () => void;
  onRequestSaveShellyPw: () => void;
  showAdvanced: boolean;
  setShowAdvanced: (v: boolean) => void;
  webhookUrl: string;
  setWebhookUrl: (v: string) => void;
  webhookUser: string;
  setWebhookUser: (v: string) => void;
  webhookKey: string;
  setWebhookKey: (v: string) => void;
  showWebhookKey: boolean;
  setShowWebhookKey: (v: boolean) => void;
  user: any;
  unitSystem: 'metric' | 'imperial';
  setUnitSystem: (v: 'metric' | 'imperial') => void;
  tempUnit: 'auto' | 'c' | 'f';
  setTempUnit: (v: 'auto' | 'c' | 'f') => void;
  timeZone: string;
  setTimeZone: (v: string) => void;
}

export default function VehiclesPanel(p: Props) {
  // "Use default hosted server" checkbox: blank sh_webhook_url always means "follow whatever
  // DEFAULT_WORKER_URL currently is" (so it silently keeps working across future domain migrations —
  // see Task 11). Checking the box doesn't WRITE that URL into storage (that would freeze it to
  // today's default); it just switches the field to a disabled, read-only display of the resolved
  // default so it's not an invisible blank. Local UI-only state: starts in custom mode only if this
  // vehicle already has a non-default value saved (an existing self-hoster).
  const [customServer, setCustomServer] = useState(() => !!p.webhookUrl);
  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '8px' }}>
        <div style={{ flex: 1 }}>
           <label className="form-label" style={{ marginBottom: '8px' }}>Active Vehicle Profile</label>
           <select className="form-input" value={p.selectedVid} onChange={(e) => p.setSelectedVid(e.target.value)}>
             {Object.values(p.vehiclesMap).map(v => (
               <option key={v.id} value={v.id}>
                 {v.config.lt_vessel_name || v.id} {v.id === p.activeVid ? '(Active)' : ''}
               </option>
             ))}
           </select>
        </div>
        <button
          className="btn-secondary"
          onClick={() => p.onSwitchVehicle(p.selectedVid)}
          disabled={p.selectedVid === p.activeVid}
          style={{ padding: '8px 16px', fontSize: '0.85rem' }}
        >
          Switch
        </button>
        <button
          className="btn-primary"
          onClick={p.onAddNewVehicle}
          style={{ padding: '8px 16px', fontSize: '0.85rem' }}
        >
          + New
        </button>
      </div>

      {/* Per-vehicle plan + upgrade link (full comparison lives on the marketing pricing page) */}
      <PlanBadge />

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px' }}>
          <div style={{ flex: 1 }}>
            <label className="form-label">Vessel / Vehicle Nickname</label>
            {p.isEditingName ? (
              <input type="text" className="form-input" placeholder="e.g. My Boat or RV" value={p.vesselNickname} onChange={(e) => p.setVesselNickname(e.target.value)} autoFocus />
            ) : (
              <div className="form-input" style={{ opacity: 0.8, height: '42px', display: 'flex', alignItems: 'center' }}>{p.vesselNickname || 'Unnamed Vessel'}</div>
            )}
          </div>
          <button
            className={p.isEditingName ? "btn-primary" : "btn-secondary"}
            onClick={() => p.setIsEditingName(!p.isEditingName)}
            style={{ padding: '8px 16px', height: '42px' }}
          >
            {p.isEditingName ? 'Save' : 'Edit'}
          </button>
        </div>

        {/* Vehicle Type (Boat / RV) — set at creation, changeable here. */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px' }}>
          <div style={{ flex: 1 }}>
            <label className="form-label">Vehicle Type</label>
            {p.isEditingType ? (
              <div style={{ display: 'flex', gap: '10px' }}>
                {([['boat', '🚤 Boat'], ['rv', '🚐 RV']] as const).map(([val, label]) => (
                  <button key={val} type="button" onClick={() => p.onChangeVehicleType(val)}
                    style={{
                      flex: 1, padding: '10px', borderRadius: '8px', cursor: 'pointer', color: '#fff',
                      border: p.vehicleType === val ? '2px solid var(--accent-cyan)' : '1px solid rgba(255,255,255,0.15)',
                      background: p.vehicleType === val ? 'rgba(0,242,254,0.12)' : 'rgba(255,255,255,0.04)',
                    }}>{label}</button>
                ))}
              </div>
            ) : (
              <div className="form-input" style={{ opacity: 0.8, height: '42px', display: 'flex', alignItems: 'center' }}>
                {p.vehicleType === 'boat' ? '🚤 Boat' : p.vehicleType === 'rv' ? '🚐 RV' : 'Not set'}
              </div>
            )}
          </div>
          <button
            className={p.isEditingType ? 'btn-primary' : 'btn-secondary'}
            onClick={() => p.setIsEditingType(!p.isEditingType)}
            style={{ padding: '8px 16px', height: '42px' }}
          >
            {p.isEditingType ? 'Done' : 'Change'}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label className="form-label">Units</label>
            <select className="form-input" value={p.unitSystem} onChange={(e) => p.setUnitSystem(e.target.value as 'metric' | 'imperial')}>
              <option value="metric">Metric (Liters)</option>
              <option value="imperial">Imperial (Gallons)</option>
            </select>
          </div>
          <div>
            <label className="form-label">Temperature</label>
            <select className="form-input" value={p.tempUnit} onChange={(e) => p.setTempUnit(e.target.value as 'auto' | 'c' | 'f')}>
              <option value="auto">Match units ({p.unitSystem === 'imperial' ? '°F' : '°C'})</option>
              <option value="f">Fahrenheit (°F)</option>
              <option value="c">Celsius (°C)</option>
            </select>
          </div>
          <div>
            <label className="form-label">Time Zone</label>
            <select className="form-input" value={p.timeZone} onChange={(e) => p.setTimeZone(e.target.value)}>
              {(Intl as any).supportedValuesOf ? (Intl as any).supportedValuesOf('timeZone').map((tz: string) => (
                <option key={tz} value={tz}>{tz}</option>
              )) : <option value={p.timeZone}>{p.timeZone}</option>}
            </select>
          </div>
        </div>

        {/* Advanced Vehicle Settings (Shelly Local Password, Custom Cloud Server URL, etc.) — collapsed by default. */}
        <div>
          <button type="button" className="btn-secondary"
            onClick={() => p.setShowAdvanced(!p.showAdvanced)}
            style={{ fontSize: '0.85rem', padding: '8px 14px' }}>
            {p.showAdvanced ? '▾' : '▸'} Advanced Vehicle Settings
          </button>
          {p.showAdvanced && (
            <div style={{ marginTop: '12px' }}>
              <label className="form-label">Shelly Local Password</label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    className="form-input"
                    type={p.showShellyPw ? 'text' : 'password'}
                    value={p.isEditingShellyPw ? p.shellyPwDraft : p.shellyLocalPassword}
                    onChange={(e) => p.setShellyPwDraft(e.target.value)}
                    readOnly={!p.isEditingShellyPw}
                    placeholder="Auto-generated per vehicle"
                    style={{ paddingRight: '44px', width: '100%', fontFamily: 'monospace', opacity: p.isEditingShellyPw ? 1 : 0.75 }}
                  />
                  <button type="button" onClick={() => p.setShowShellyPw(!p.showShellyPw)} aria-label={p.showShellyPw ? 'Hide' : 'Show'}
                    style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '4px' }}>
                    {p.showShellyPw ? '🙈' : '👁️'}
                  </button>
                </div>
                {p.isEditingShellyPw && (
                  <button className="btn-secondary" style={{ padding: '8px 12px', height: '42px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                    onClick={async () => { const { generateShellyPassword } = await import('../../utils/VehicleManager'); p.setShellyPwDraft(generateShellyPassword()); }}>
                    🎲 Regenerate
                  </button>
                )}
                <button className={p.isEditingShellyPw ? 'btn-primary' : 'btn-secondary'} style={{ padding: '8px 16px', height: '42px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                  onClick={() => p.isEditingShellyPw ? p.onRequestSaveShellyPw() : p.onStartEditShellyPw()}>
                  {p.isEditingShellyPw ? 'Save' : 'Edit'}
                </button>
                {p.isEditingShellyPw && (
                  <button className="btn-secondary" style={{ padding: '8px 12px', height: '42px', fontSize: '0.8rem' }}
                    onClick={() => { p.setIsEditingShellyPw(false); p.setPwChangeMsg(null); }}>
                    Cancel
                  </button>
                )}
              </div>
              {p.pwChangeMsg && (
                <p style={{ fontSize: '0.78rem', color: p.pwChangeMsg.ok ? 'var(--success-color, #10b981)' : '#ffb3b3', margin: '6px 0 0 0' }}>{p.pwChangeMsg.text}</p>
              )}
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '6px 0 12px 0' }}>
                Set on your Shelly devices during setup and used for secure local access. Shared across this vehicle's devices. Changing it here pushes the new password to every Shelly device on this vehicle.
              </p>
              <label className="form-label" style={{ fontWeight: 600 }}>Custom Cloud Server URL</label>
              <label className="form-label">Cloud Alert Worker URL</label>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 6px 0' }}>
                For users running their own cloud server (the self-hostable Guardian cloud server, or a Cloudflare worker). Required for Shelly devices to push away-from-home alerts. Set this before adding devices.
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', margin: '0 0 8px 0', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={!customServer}
                  onChange={(e) => {
                    const useDefault = e.target.checked;
                    setCustomServer(!useDefault);
                    if (useDefault) p.setWebhookUrl('');
                  }}
                />
                Use default hosted server ({DEFAULT_WORKER_URL.replace(/^https:\/\//, '')})
              </label>
              <input
                className="form-input" type="url"
                value={customServer ? p.webhookUrl : DEFAULT_WORKER_URL}
                onChange={(e) => p.setWebhookUrl(e.target.value)}
                disabled={!customServer}
                placeholder="https://your-server.example.com"
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                style={!customServer ? { opacity: 0.6 } : undefined}
              />
              <label className="form-label" style={{ marginTop: '12px' }}>Username</label>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 6px 0' }}>
                The username created in your server's admin page. Leave blank if your server doesn't require auth.
              </p>
              <input className="form-input" type="text" value={p.webhookUser} onChange={(e) => p.setWebhookUser(e.target.value)} placeholder="self-host server username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" />
              <label className="form-label" style={{ marginTop: '12px' }}>API Key</label>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 6px 0' }}>
                The API key paired with that username. Stored with this vehicle and used to authenticate to your server.
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input className="form-input" type={p.showWebhookKey ? 'text' : 'password'} value={p.webhookKey} onChange={(e) => p.setWebhookKey(e.target.value)} placeholder="self-host server API key" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" style={{ flex: 1 }} />
                <button type="button" className="btn-secondary" onClick={() => p.setShowWebhookKey(!p.showWebhookKey)} style={{ fontSize: '0.8rem', padding: '8px 12px' }}>{p.showWebhookKey ? 'Hide' : 'Show'}</button>
              </div>
            </div>
          )}
        </div>


    </div>
  );
}
