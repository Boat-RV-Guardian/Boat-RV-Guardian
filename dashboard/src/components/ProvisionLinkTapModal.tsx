import { useState, useEffect } from 'react';
import { addDevice } from '../utils/VehicleManager';
import { nativeFetch } from '../utils/nativeFetch';
import { linkTapGetApiKey } from '../utils/linktapCloud';

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

type Step = 'credentials' | 'fetching' | 'device_selection' | 'completion';

export default function ProvisionLinkTapModal({ onClose }: { onClose: () => void }) {
  // Guided setup: if the account isn't connected yet (no stored username + API key), start by
  // collecting the LinkTap username + password and fetching the API key — so a first-time user never
  // has to configure anything on a separate settings tab first.
  const hasCreds = !!(localStorage.getItem('lt_cloud_user') && localStorage.getItem('lt_cloud_key'));
  const [step, setStep] = useState<Step>(hasCreds ? 'fetching' : 'credentials');
  const [availableDevices, setAvailableDevices] = useState<{ id: string, name: string, gatewayId: string }[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<{text: string, type: 'error'|'success'|'info'} | null>(null);

  // Credentials step
  const [username, setUsername] = useState(() => localStorage.getItem('lt_cloud_user') || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [credBusy, setCredBusy] = useState(false);
  // What this valve will be called in the app (editable later in Settings → Devices → Configuration).
  const [deviceName, setDeviceName] = useState('');

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

    if (devicesList.length > 0) {
      setAvailableDevices(devicesList);
      setSelectedDeviceId(devicesList[0].id);
      setStep('device_selection');
      setStatusMessage(null);
    } else {
      setStatusMessage({ text: 'No TapLinker valves found on your LinkTap account. Make sure your valve is paired to a gateway in the LinkTap app.', type: 'error' });
    }
  };

  // Run device discovery whenever we enter the fetching step (on mount when already connected, or
  // right after the credentials step fetches the API key).
  useEffect(() => {
    if (step !== 'fetching') return;
    let isMounted = true;
    (async () => { if (isMounted) await fetchAllDevices(); })();
    return () => { isMounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Credentials step: fetch (create/retrieve) the account API key from username + password, store the
  // username + key, then advance to device discovery. The password is used once and never stored.
  const handleConnectAccount = async () => {
    setCredBusy(true);
    setStatusMessage(null);
    try {
      const key = await linkTapGetApiKey(username.trim(), password, false);
      localStorage.setItem('lt_cloud_user', username.trim());
      localStorage.setItem('lt_cloud_key', key);
      setPassword('');
      window.dispatchEvent(new Event('settings_updated'));
      setStep('fetching');
    } catch (e: any) {
      setStatusMessage({ text: e?.message || 'Could not connect to your LinkTap account.', type: 'error' });
    } finally {
      setCredBusy(false);
    }
  };

  const handleCreateDevice = async () => {
    const device = availableDevices.find(d => d.id === selectedDeviceId);
    if (!device) return;

    // Configure the vehicle's LinkTap connection up front — everything the Advanced Options page's
    // "Retrieve Devices from Cloud" + Connect would have done, so onboarding is one pass:
    //  - gateway + TapLinker IDs (from the getAllDevices data we already fetched),
    //  - cloud controller ON (creds were just validated by getApiKey / device fetch),
    //  - the gateway's LAN IP via local discovery where the platform supports it (Tauri desktop;
    //    Android has no LAN-scan path yet — the widget's cloud/server path works without it).
    // Never overwrite values the user already set. Written to localStorage BEFORE addDevice so its
    // settings_updated dispatch rehydrates the Settings page's state with these values.
    if (!localStorage.getItem('lt_gateway_id')) localStorage.setItem('lt_gateway_id', device.gatewayId);
    const primary = localStorage.getItem('lt_device_id') || '';
    if (!primary) localStorage.setItem('lt_device_id', device.id);
    else if (primary !== device.id && !localStorage.getItem('lt_device_id_2')) localStorage.setItem('lt_device_id_2', device.id);
    localStorage.setItem('lt_is_cloud_polling', 'true');
    if (isTauriEnv() && !localStorage.getItem('lt_gateway_ip')) {
      try {
        setStatusMessage({ text: 'Looking for your gateway on this network…', type: 'info' });
        const { invoke } = await import('@tauri-apps/api/core');
        const found = await invoke<string[]>('discover_gateway');
        if (found && found[0]) localStorage.setItem('lt_gateway_ip', found[0]);
      } catch { /* best-effort — local control can be configured later */ }
      setStatusMessage(null);
    }

    addDevice({
      id: 'brv_lt_' + Math.random().toString(36).substr(2, 9),
      type: 'linktap_valve',
      role: 'Fresh Water', // Default role
      name: deviceName.trim() || device.name, // user's chosen name, falling back to LinkTap's
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

        {step === 'credentials' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
              Sign in with your LinkTap account to connect your valve. We'll fetch your API key for you —
              no need to copy anything by hand.
            </p>
            <div>
              <label className="form-label">LinkTap Username</label>
              <input type="text" className="form-input" value={username} autoComplete="username"
                onChange={(e) => setUsername(e.target.value)} placeholder="Your LinkTap account username" />
            </div>
            <div>
              <label className="form-label">LinkTap Password</label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input type={showPassword ? 'text' : 'password'} className="form-input" value={password} autoComplete="current-password"
                  autoCapitalize="off" autoCorrect="off" style={{ paddingRight: '40px' }}
                  onChange={(e) => setPassword(e.target.value)} placeholder="Your LinkTap account password"
                  onKeyDown={(e) => { if (e.key === 'Enter' && username && password && !credBusy) handleConnectAccount(); }} />
                <button
                  className="btn-secondary"
                  onClick={() => setShowPassword(!showPassword)}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  style={{ position: 'absolute', right: '8px', background: 'transparent', border: 'none', padding: '4px', cursor: 'pointer', opacity: 0.6 }}
                >
                  {showPassword ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>Used once to fetch your API key — never stored.</div>
            </div>
            {statusMessage && <div style={{ color: statusMessage.type === 'error' ? '#ef4444' : 'var(--accent-cyan)', fontSize: '0.85rem' }}>{statusMessage.text}</div>}
            <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between' }}>
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={handleConnectAccount} disabled={credBusy || !username || !password}>
                {credBusy ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          </div>
        )}

        {step === 'fetching' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', textAlign: 'center', padding: '40px 0' }}>
            {statusMessage && <div style={{ color: statusMessage.type === 'error' ? '#ef4444' : 'var(--accent-cyan)' }}>{statusMessage.text}</div>}
            {statusMessage?.type === 'error' && (
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '20px' }}>
                <button className="btn-secondary" onClick={() => { setStatusMessage(null); setStep('credentials'); }}>← Re-enter account</button>
                <button className="btn-secondary" onClick={onClose}>Close</button>
              </div>
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

            <div>
              <label className="form-label">Name this valve</label>
              <input type="text" className="form-input" value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder={availableDevices.find(d => d.id === selectedDeviceId)?.name || 'e.g. Fresh Water Fill'} />
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                How it appears in the app. Leave blank to keep the LinkTap name. You can rename it later in Configuration.
              </div>
            </div>

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
              Your LinkTap Valve has been added and connected: cloud control is on and the gateway &amp;
              valve IDs are configured. Fine-tune it any time in Settings → Devices → Configuration.
            </p>
            <button className="btn-primary" onClick={onClose} style={{ width: '100%', padding: '12px' }}>Done</button>
          </div>
        )}

      </div>
    </div>
  );
}
