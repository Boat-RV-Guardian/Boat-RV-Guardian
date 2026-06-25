// "Add a device" tab (Settings → Devices → + Add a device). Extracted from Settings.tsx as part of
// the Task 3 split. Two type pickers that open the LinkTap / Shelly provisioning modals (which stay
// in Settings). Pure presentational.

interface Props {
  onAddLinkTap: () => void;
  onAddShelly: () => void;
}

export default function AddDevicePanel({ onAddLinkTap, onAddShelly }: Props) {
  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', padding: '40px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: '3rem', marginBottom: '8px' }}>➕</div>
      <h3 style={{ margin: 0, color: 'var(--accent-cyan)' }}>Add a New Device</h3>
      <p style={{ color: 'var(--text-secondary)', maxWidth: '400px', marginBottom: '24px' }}>
        Select the type of device you want to add to this vehicle.
      </p>

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button className="btn-secondary" onClick={onAddLinkTap} style={{ padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', width: '200px' }}>
          <span style={{ fontSize: '2rem' }}>🚰</span>
          <strong>LinkTap Valve</strong>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Water Shutoff Valve</span>
        </button>
        <button className="btn-secondary" onClick={onAddShelly} style={{ padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', width: '200px', borderColor: '#f59e0b' }}>
          <span style={{ fontSize: '2rem' }}>⚡</span>
          <strong style={{ color: '#f59e0b' }}>Shelly Sensor</strong>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Power, Voltage, or Flood</span>
        </button>
      </div>
    </div>
  );
}
