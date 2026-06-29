// Alerts destination (Task 16 IA). Step 2 ships a placeholder so the 4-item nav is complete; step 3
// fills it with the merged event history + current-issues banner + push-channel management.

export default function Alerts() {
  return (
    <div style={{ padding: '20px', maxWidth: '900px', margin: '0 auto', color: '#fff', paddingBottom: '100px' }}>
      <h2 style={{ fontSize: '2rem', color: 'var(--accent-cyan)', margin: '0 0 16px' }}>Alerts</h2>
      <div className="glass-card" style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>
        A unified view of recent events and current issues is coming here, along with your notification
        preferences. For now, per-device event logs live on each sensor.
      </div>
    </div>
  );
}
