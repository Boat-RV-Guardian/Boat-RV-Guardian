// Device Preferences card (Settings → General). Extracted from Settings.tsx as part of the Task 3
// split. Owns the card shell + the device-local Units / Time Zone selects; the Notifications & Alarms
// block is passed in as children (NotificationsPanel keeps its own props in Settings). These
// preferences are saved on this device only — not synced to the cloud.

import type { ReactNode } from 'react';

interface Props {
  unitSystem: 'metric' | 'imperial';
  setUnitSystem: (v: 'metric' | 'imperial') => void;
  timeZone: string;
  setTimeZone: (v: string) => void;
  children: ReactNode;
}

export default function DevicePreferencesPanel({ unitSystem, setUnitSystem, timeZone, setTimeZone, children }: Props) {
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
          <label className="form-label">Time Zone</label>
          <select className="form-input" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
            {(Intl as any).supportedValuesOf ? (Intl as any).supportedValuesOf('timeZone').map((tz: string) => (
              <option key={tz} value={tz}>{tz}</option>
            )) : <option value={timeZone}>{timeZone}</option>}
          </select>
        </div>
      </div>

      {children}
    </div>
  );
}
