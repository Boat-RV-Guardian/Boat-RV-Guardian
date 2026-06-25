// Advanced device thresholds panel (Settings → Devices → Advanced Options). Extracted from
// Settings.tsx as part of the Task 3 split. Pure presentational: battery + shore-power alert
// thresholds plus the battery chemistry/system preset pickers. State + persistence stay in Settings.

import { BATTERY_PRESETS } from '../../utils/batteryPresets';

// One labeled 0–35 V numeric field with a trailing "V" adornment and a hint line. Shared by the
// battery and shore-power grids so the repetitive markup lives in one place.
function VoltageField({ label, hint, value, min, max, step, onChange }: {
  label: string; hint: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <div style={{ position: 'relative' }}>
        <input type="number" min={min} max={max} step={step} className="form-input"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ paddingRight: '32px' }} />
        <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: 'var(--text-secondary)', pointerEvents: 'none' }}>V</span>
      </div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>{hint}</div>
    </div>
  );
}

interface Props {
  battType: string;
  battSystemV: string;
  onApplyBatteryPreset: (type: string, sysV: string) => void;
  // Manually editing any battery threshold flips the chemistry to 'custom'.
  onBattCustom: () => void;
  battCritVoltage: number; onBattCritChange: (v: number) => void;
  battLowVoltage: number; onBattLowChange: (v: number) => void;
  battNormalVoltage: number; onBattNormalChange: (v: number) => void;
  battChargeVoltage: number; onBattChargeChange: (v: number) => void;
  battOverVoltage: number; onBattOverChange: (v: number) => void;
  shoreCritLowV: number; onShoreCritLowChange: (v: number) => void;
  shoreLowV: number; onShoreLowChange: (v: number) => void;
  shoreNormalV: number; onShoreNormalChange: (v: number) => void;
  shoreHighV: number; onShoreHighChange: (v: number) => void;
  shoreCritHighV: number; onShoreCritHighChange: (v: number) => void;
}

export default function AdvancedDeviceSettingsPanel(p: Props) {
  // Battery thresholds round to 0.1 V and mark the chemistry 'custom' (manual override).
  const battEdit = (set: (v: number) => void) => (v: number) => { set(Number(v.toFixed(1))); p.onBattCustom(); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Fresh Water */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h3 style={{ marginTop: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', margin: 0 }}>Fresh Water</h3>
        <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.9rem' }}>
          Normal Run Profile settings are now configured per device. Go to <strong>Configuration</strong> → select a valve → tap the ⚙️ gear icon.
        </p>
      </div>

      {/* High Water/Flood */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h3 style={{ marginTop: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', margin: 0 }}>High Water/Flood</h3>
        <p style={{ color: 'var(--text-secondary)', margin: 0 }}>No advanced settings currently available.</p>
      </div>

      {/* Batteries */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h3 style={{ marginTop: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', margin: 0 }}>Batteries</h3>
        <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.85rem' }}>Alert thresholds applied to house and engine battery sensors.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
          <div>
            <label className="form-label">Battery Type</label>
            <select className="form-input" value={p.battType} onChange={(e) => p.onApplyBatteryPreset(e.target.value, p.battSystemV)}>
              {Object.entries(BATTERY_PRESETS).map(([key, preset]) => (
                <option key={key} value={key}>{preset.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">System</label>
            <select className="form-input" value={p.battSystemV} onChange={(e) => p.onApplyBatteryPreset(p.battType, e.target.value)}>
              <option value="12">12 V</option>
              <option value="24">24 V</option>
            </select>
          </div>
        </div>
        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '-6px 0 0 0' }}>
          Choosing a battery type / system fills the thresholds below with recommended values. Pick <strong>Custom (manual)</strong> — or just edit any field — to set your own.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px' }}>
          <VoltageField label="Critical Voltage" hint="Triggers critical alarm" min={8} max={35} step={0.1} value={p.battCritVoltage} onChange={battEdit(p.onBattCritChange)} />
          <VoltageField label="Low Voltage" hint="Triggers low-battery warning" min={8} max={35} step={0.1} value={p.battLowVoltage} onChange={battEdit(p.onBattLowChange)} />
          <VoltageField label="Normal Voltage" hint="Nominal resting voltage" min={8} max={35} step={0.1} value={p.battNormalVoltage} onChange={battEdit(p.onBattNormalChange)} />
          <VoltageField label="Charging" hint="Indicates charging in progress" min={8} max={35} step={0.1} value={p.battChargeVoltage} onChange={battEdit(p.onBattChargeChange)} />
          <VoltageField label="Over Voltage" hint="Triggers over-voltage alarm" min={8} max={35} step={0.1} value={p.battOverVoltage} onChange={battEdit(p.onBattOverChange)} />
        </div>
      </div>

      {/* Shore Power */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h3 style={{ marginTop: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', margin: 0 }}>⚡ Shore Power</h3>
        <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.85rem' }}>Alert thresholds applied to shore power / AC inlet sensors.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px' }}>
          <VoltageField label="Critical Low" hint="Triggers critical alarm" min={0} max={120} step={1} value={p.shoreCritLowV} onChange={p.onShoreCritLowChange} />
          <VoltageField label="Low Voltage" hint="Triggers low-voltage warning" min={0} max={120} step={1} value={p.shoreLowV} onChange={p.onShoreLowChange} />
          <VoltageField label="Normal Voltage" hint="Nominal line voltage" min={90} max={160} step={1} value={p.shoreNormalV} onChange={p.onShoreNormalChange} />
          <VoltageField label="High Voltage" hint="Triggers high-voltage warning" min={110} max={160} step={1} value={p.shoreHighV} onChange={p.onShoreHighChange} />
          <VoltageField label="Critical High" hint="Triggers critical alarm" min={110} max={160} step={1} value={p.shoreCritHighV} onChange={p.onShoreCritHighChange} />
        </div>
      </div>

    </div>
  );
}
