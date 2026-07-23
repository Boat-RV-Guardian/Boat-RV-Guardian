// Device Preferences card (Settings → General). Extracted from Settings.tsx as part of the Task 3
// split. Owns the card shell + the device-local Units / Time Zone selects; the Notifications & Alarms
// block is passed in as children (NotificationsPanel keeps its own props in Settings). These
// preferences are saved on this device only — not synced to the cloud.

import { useState, type ReactNode } from 'react';

interface Props {
  unitSystem: 'metric' | 'imperial';
  setUnitSystem: (v: 'metric' | 'imperial') => void;
  tempUnit: 'auto' | 'c' | 'f';
  setTempUnit: (v: 'auto' | 'c' | 'f') => void;
  timeZone: string;
  setTimeZone: (v: string) => void;
  children: ReactNode;
}

export default function DevicePreferencesPanel({ unitSystem, setUnitSystem, tempUnit, setTempUnit, timeZone, setTimeZone, children }: Props) {
  // Device-local QA flag (not synced): shows the top event-simulator bar so alerts/dashboard states can
  // be exercised without hardware. App.tsx reads lt_event_sim on the settings_updated event.
  const [eventSim, setEventSim] = useState(() => localStorage.getItem('lt_event_sim') === '1');
  const toggleEventSim = (on: boolean) => {
    setEventSim(on);
    localStorage.setItem('lt_event_sim', on ? '1' : '0');
    window.dispatchEvent(new Event('settings_updated'));
  };

  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <h3 style={{ marginTop: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', margin: '0 0 4px 0' }}>Device Preferences</h3>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Saved on this device only — not synced to the cloud.</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div>
          <label className="form-label">Units</label>
          <select className="form-input" value={unitSystem} onChange={(e) => setUnitSystem(e.target.value as 'metric' | 'imperial')}>
            <option value="metric">Metric (Liters)</option>
            <option value="imperial">Imperial (Gallons)</option>
          </select>
        </div>
        <div>
          <label className="form-label">Temperature</label>
          <select className="form-input" value={tempUnit} onChange={(e) => setTempUnit(e.target.value as 'auto' | 'c' | 'f')}>
            <option value="auto">Match units ({unitSystem === 'imperial' ? '°F' : '°C'})</option>
            <option value="f">Fahrenheit (°F)</option>
            <option value="c">Celsius (°C)</option>
          </select>
        </div>
        <div>
          <label className="form-label">Time Zone</label>
          <select className="form-input" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
            {(Intl as any).supportedValuesOf ? (Intl as any).supportedValuesOf('timeZone').map((tz: string) => (
              <option key={tz} value={tz}>{tz}</option>
            )) : <option value={timeZone}>{timeZone}</option>}
          </select>
        </div>
      </div>

      {children}

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '14px' }}>
        <input type="checkbox" checked={eventSim} onChange={(e) => toggleEventSim(e.target.checked)} style={{ marginTop: '3px' }} />
        <span>
          <span style={{ fontSize: '0.9rem', color: '#fff' }}>🧪 Event simulator (testing)</span>
          <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Shows a top bar to fire each sensor event (flood, low battery, shore loss, freeze…) so alerts and
            dashboard states can be checked without hardware.
          </span>
        </span>
      </label>
    </div>
  );
}
