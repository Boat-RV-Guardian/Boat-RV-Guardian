import { useState, useEffect } from 'react';
import { addDevice } from '../utils/VehicleManager';
import { nativeFetch } from '../utils/nativeFetch';

// Helper to use Tauri's fetch if available, otherwise browser fetch
const isTauriEnv = () => typeof window !== 'undefined' && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).isTauri);

const unifiedFetch = async (url: string, options?: any) => {
  if (isTauriEnv()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(url, {
      method: options?.method || 'GET',
      headers: options?.headers,
      body: options?.body
    });
  }
  return nativeFetch(url, options) as any;
};

export default function ProvisionLinkTapModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<'fetching' | 'device_selection' | 'completion'>('fetching');
  const [availableDevices, setAvailableDevices] = useState<{ id: string, name: string, gatewayId: string }[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<{text: string, type: 'error'|'success'|'info'} | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchAllDevices = async () => {
      setStatusMessage({ text: 'Fetching your LinkTap devices...', type: 'info' });
      
      const devicesList: { id: string, name: string, gatewayId: string }[] = [];
      const cloudUsername = localStorage.getItem('lt_cloud_user') || '';
      const cloudApiKey = localStorage.getItem('lt_cloud_key') || '';

      // Add local devices
      try {
        const localDevicesStr = localStorage.getItem('lt_local_devices');
        if (localDevicesStr) {
          const localList = JSON.parse(localDevicesStr);
          localList.forEach((d: any) => {
            devicesList.push({ id: d.deviceId, name: d.name || d.deviceId, gatewayId: d.gatewayId });
          });
        }
      } catch (e) {
        console.error("Failed to parse local devices", e);
      }
      
      // Fetch cloud devices
      if (cloudUsername && cloudApiKey) {
        try {
          const res = await unifiedFetch('https://www.link-tap.com/api/getAllDevices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: cloudUsername, apiKey: cloudApiKey })
          });
          
          const rawText = await res.text();
          const data = JSON.parse(rawText);
          
          if (data.devices && data.devices.length > 0) {
            data.devices.forEach((gw: any) => {
              if (gw.taplinker && gw.taplinker.length > 0) {
                gw.taplinker.forEach((tap: any) => {
                  // Prevent duplicates
                  if (!devicesList.find(d => d.id === tap.taplinkerId)) {
                    devicesList.push({
                      id: tap.taplinkerId,
                      name: tap.taplinkerName || tap.taplinkerId,
                      gatewayId: gw.gatewayId
                    });
                  }
                });
              }
            });
          }
        } catch(e: any) {
          console.error("Cloud fetch failed", e);
        }
      }

      if (!isMounted) return;

      if (devicesList.length > 0) {
        setAvailableDevices(devicesList);
        setSelectedDeviceId(devicesList[0].id);
        setStep('device_selection');
        setStatusMessage(null);
      } else {
        setStatusMessage({ text: 'No TapLinker devices found. Add Cloud credentials or Local Devices in the Auth Tab.', type: 'error' });
      }
    };

    fetchAllDevices();

    return () => { isMounted = false; };
  }, []);

  const handleCreateDevice = () => {
    const device = availableDevices.find(d => d.id === selectedDeviceId);
    if (!device) return;

    addDevice({
      id: 'brv_lt_' + Math.random().toString(36).substr(2, 9),
      type: 'linktap_valve',
      role: 'Fresh Water', // Default role
      name: device.name,
      linktapGatewayId: device.gatewayId,
      linktapDeviceId: device.id,
      maxDuration: 30,
      autoGuardEnabled: true
    });
    
    setStep('completion');
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(5px)',
      display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
    }}>
      <div className="glass-card" style={{ width: '100%', maxWidth: '500px', padding: '30px', position: 'relative' }}>
        <button onClick={onClose} style={{
          position: 'absolute', top: '15px', right: '15px', background: 'none', border: 'none',
          color: '#fff', fontSize: '1.5rem', cursor: 'pointer'
        }}>×</button>

        <h2 style={{ marginTop: 0, color: 'var(--accent-cyan)', marginBottom: '20px' }}>Add LinkTap Valve</h2>

        {step === 'fetching' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', textAlign: 'center', padding: '40px 0' }}>
            {statusMessage && <div style={{ color: statusMessage.type === 'error' ? '#ef4444' : 'var(--accent-cyan)' }}>{statusMessage.text}</div>}
            {statusMessage?.type === 'error' && (
              <button className="btn-secondary" onClick={onClose} style={{ marginTop: '20px' }}>Close</button>
            )}
          </div>
        )}

        {step === 'device_selection' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <h3 style={{ margin: 0, color: '#fff' }}>Select a Valve</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '10px' }}>Select the valve you want to add to this vehicle.</p>
            
            <select className="form-input" value={selectedDeviceId} onChange={(e) => setSelectedDeviceId(e.target.value)}>
              {availableDevices.map(d => (
                <option key={d.id} value={d.id}>{d.name} ({d.id})</option>
              ))}
            </select>
            
            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between' }}>
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={handleCreateDevice} disabled={!selectedDeviceId}>Add Valve</button>
            </div>
          </div>
        )}

        {step === 'completion' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: '4rem', marginBottom: '10px' }}>✅</div>
            <h3 style={{ color: '#10b981', margin: '0 0 10px 0' }}>Valve Added!</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>
              Your LinkTap Valve has been successfully added to this vehicle. You can configure its specific settings in the Configuration tab.
            </p>
            <button className="btn-primary" onClick={onClose} style={{ width: '100%', padding: '12px' }}>Done</button>
          </div>
        )}

      </div>
    </div>
  );
}
