import { useState, useEffect } from 'react';
import { getDevices, type DeviceConfig } from '../utils/VehicleManager';
import ShellyWidget from '../components/ShellyWidget';

// Category → Shelly device role. Sensors now renders the provisioned-device model (lt_devices)
// through ShellyWidget, which polls locally first (auth-aware) and falls back to Shelly cloud —
// the same path as the Dashboard. The old sh_high_power/sh_low_power/sh_flood arrays are retired.
const CATEGORY: Record<string, { role: string; title: string; color: string }> = {
  shore_power: { role: 'High Power Sensor', title: 'Shore Power (120v/240v)', color: '#f59e0b' },
  batteries:   { role: 'Low Power Sensor',  title: 'Batteries (10-26v)',      color: '#10b981' },
  flood:       { role: 'Flood Sensor',      title: 'High Water / Flood Sensors', color: '#3b82f6' },
};

export default function Sensors({ category }: { category: 'flood' | 'batteries' | 'shore_power' }) {
  const [devices, setDevices] = useState<DeviceConfig[]>(() => getDevices());

  useEffect(() => {
    const refresh = () => setDevices(getDevices());
    window.addEventListener('settings_updated', refresh);
    return () => window.removeEventListener('settings_updated', refresh);
  }, []);

  const cfg = CATEGORY[category];
  const catDevices = devices.filter((d) => d.type === 'shelly_sensor' && d.role === cfg.role);

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto', color: '#fff', paddingBottom: '100px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '2rem', color: 'var(--accent-cyan)', margin: 0 }}>{cfg.title}</h2>
      </div>

      {catDevices.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}>
          <p style={{ color: 'var(--text-secondary)' }}>
            No {cfg.role.toLowerCase()}s configured yet. Add one in Settings → Devices → Add Device.
          </p>
        </div>
      ) : (
        <div>
          <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', marginBottom: '16px', color: cfg.color }}>{cfg.title}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
            {catDevices.map((device) => (
              <ShellyWidget key={device.id} device={device} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
