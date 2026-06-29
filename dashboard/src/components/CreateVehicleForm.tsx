import { useState } from 'react';

export type VehicleType = 'boat' | 'rv';

// First-run / add-vehicle form: capture the vehicle NAME and TYPE (Boat or RV) before creating it.
// Presentational + dependency-injected (onCreate) so it's testable without VehicleManager/Firebase.
export default function CreateVehicleForm({ onCreate }: { onCreate: (name: string, type: VehicleType) => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<VehicleType | ''>('');
  const canCreate = name.trim().length > 0 && type !== '';

  const typeBtn = (value: VehicleType, emoji: string, label: string) => (
    <button
      type="button"
      aria-pressed={type === value}
      onClick={() => setType(value)}
      style={{
        flex: 1, padding: '12px', borderRadius: '10px', cursor: 'pointer',
        border: type === value ? '2px solid var(--accent-cyan)' : '1px solid rgba(255,255,255,0.15)',
        background: type === value ? 'rgba(0,242,254,0.12)' : 'rgba(255,255,255,0.04)',
        color: '#fff', fontSize: '0.95rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
      }}
    >
      <span style={{ fontSize: '1.6rem' }}>{emoji}</span>
      {label}
    </button>
  );

  return (
    <div className="card" style={{ width: '100%', maxWidth: '420px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <h3 style={{ margin: 0, textAlign: 'center', color: '#fff' }}>Add your first vehicle</h3>
      <div>
        <label style={{ display: 'block', marginBottom: '5px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Sea Breeze"
          aria-label="Vehicle name"
          style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: '#fff' }}
        />
      </div>
      <div>
        <label style={{ display: 'block', marginBottom: '5px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Type</label>
        <div style={{ display: 'flex', gap: '10px' }}>
          {typeBtn('boat', '🚤', 'Boat')}
          {typeBtn('rv', '🚐', 'RV')}
        </div>
      </div>
      <button
        className="btn-primary"
        disabled={!canCreate}
        onClick={() => canCreate && onCreate(name.trim(), type as VehicleType)}
        style={{ marginTop: '4px', opacity: canCreate ? 1 : 0.5, cursor: canCreate ? 'pointer' : 'not-allowed' }}
      >
        Create vehicle
      </button>
    </div>
  );
}
