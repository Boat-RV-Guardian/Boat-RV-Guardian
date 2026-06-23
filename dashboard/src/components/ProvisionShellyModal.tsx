import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { nativeFetch } from '../utils/nativeFetch';
import { auth } from '../services/firebase';
import { DEFAULT_WORKER_URL } from '../utils/configSync';

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

// Map a Shelly device's reported identity to one of our sensor roles. Returns null when we
// can't confidently tell (the user then keeps whatever they picked).
const detectRole = (info: any): string | null => {
  const hay = `${info?.app || ''} ${info?.model || ''} ${info?.id || ''}`.toLowerCase();
  if (hay.includes('flood')) return 'Flood Sensor';
  if (hay.includes('uni')) return 'Low Power Sensor';                 // Plus Uni → DC 12-24V monitoring
  if (hay.includes('em') || hay.includes('pm')) return 'High Power Sensor'; // mains energy/power meter
  return null;
};

export default function ProvisionShellyModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<'selection' | 'ble_scanning' | 'credentials' | 'ip_entry' | 'provisioning' | 'confirm_type' | 'completion'>('selection');
  const [method, setMethod] = useState<'wifi' | 'manual_ip' | 'bluetooth' | null>(null);

  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localIp, setLocalIp] = useState('');
  const [shellyPassword, setShellyPassword] = useState('');
  const [showShellyPassword, setShowShellyPassword] = useState(false);
  const [deviceRole, setDeviceRole] = useState('High Power Sensor');
  // Carried from provisioning into the confirm step
  const [shellyId, setShellyId] = useState('UNKNOWN_SHELLY');
  const [detectedModel, setDetectedModel] = useState('');
  const [roleAutoDetected, setRoleAutoDetected] = useState(false);
  const [bleLocalIp, setBleLocalIp] = useState(''); // IP learned over BLE after the device joins Wi-Fi
  const [bleJoinStatus, setBleJoinStatus] = useState(''); // last Wi-Fi status if it didn't get an IP
  
  // Bluetooth specific state
  const [bleDevices, setBleDevices] = useState<{ deviceId: string, name: string }[]>([]);
  const [selectedBleDevice, setSelectedBleDevice] = useState<string>(''); // holds the platform deviceId
  
  const [statusMessage, setStatusMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Wi-Fi scan (asks the Shelly to list networks it can see, via its Gen2 Wifi.Scan RPC)
  const [isScanningWifi, setIsScanningWifi] = useState(false);
  const [wifiScanResults, setWifiScanResults] = useState<{ ssid: string; rssi: number }[]>([]);
  const [wifiScanMsg, setWifiScanMsg] = useState('');

  // Bluetooth is only available on native Android/iOS. Desktop/web use Wi-Fi AP / Manual IP.
  const plat = Capacitor.getPlatform();
  const bleSupported = Capacitor.isNativePlatform() && (plat === 'android' || plat === 'ios');
  const isMobile = bleSupported;

  const handleSelectMethod = (selected: 'wifi' | 'manual_ip' | 'bluetooth') => {
    setMethod(selected);
    if (selected === 'wifi') setStep('credentials');
    if (selected === 'manual_ip') setStep('ip_entry');
    if (selected === 'bluetooth') {
      setStep('ble_scanning');
      startBleScan();
    }
  };

  const startBleScan = async () => {
    setIsProcessing(true);
    setBleDevices([]);
    setSelectedBleDevice('');
    setStatusMessage('Scanning for nearby Shelly devices…');
    try {
      const { scanShellyDevices } = await import('../utils/shellyBle');
      const found = await scanShellyDevices(6000);
      setBleDevices(found);
      if (found.length > 0) setSelectedBleDevice(found[0].deviceId);
      setStatusMessage('');
    } catch (e: any) {
      setStatusMessage(`Bluetooth scan failed: ${e?.message || e}. Enable Bluetooth & grant permission, then retry.`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleScanWifi = async () => {
    setIsScanningWifi(true);
    setWifiScanMsg('');
    try {
      let list: { ssid: string; rssi: number }[];
      if (method === 'bluetooth') {
        // Ask the device for nearby networks over BLE (it scans on our behalf).
        const { bleScanWifi } = await import('../utils/shellyBle');
        list = await bleScanWifi(selectedBleDevice);
      } else {
        // Wi-Fi AP method: ask the Shelly (192.168.33.1) over HTTP RPC.
        const { shellyRpc } = await import('../utils/shellyRpc');
        const result = await shellyRpc('192.168.33.1', 'Wifi.Scan', {});
        const raw: any[] = result?.results || result?.aps || [];
        const best = new Map<string, number>();
        for (const ap of raw) {
          const s = (ap?.ssid || '').trim();
          if (!s) continue;
          const rssi = typeof ap?.rssi === 'number' ? ap.rssi : -100;
          if (!best.has(s) || rssi > (best.get(s) as number)) best.set(s, rssi);
        }
        list = [...best.entries()].map(([ssid, rssi]) => ({ ssid, rssi })).sort((a, b) => b.rssi - a.rssi);
      }

      if (list.length === 0) {
        setWifiScanMsg('No networks reported. Enter the SSID manually below.');
      } else {
        setWifiScanResults(list);
        if (!ssid) setSsid(list[0].ssid);
      }
    } catch (e: any) {
      setWifiScanMsg(
        method === 'bluetooth'
          ? `Couldn't scan over Bluetooth: ${e?.message || e}. Make sure the device is nearby, or type the SSID manually.`
          : (Capacitor.getPlatform() === 'android'
              ? "Couldn't reach the Shelly. On Android, join the Shelly's Wi-Fi AP and turn OFF mobile data, then retry — or type the SSID manually."
              : "Couldn't reach the Shelly. Make sure you're connected to its Wi-Fi AP, then retry — or type the SSID manually.")
      );
    } finally {
      setIsScanningWifi(false);
    }
  };

  const executeWifiProvisioning = async () => {
    setIsProcessing(true);
    try {
      setStatusMessage('Getting Device ID (1/3)...');
      let shellyDeviceId = 'UNKNOWN_SHELLY';
      try {
        const infoRes = await unifiedFetch(`http://192.168.33.1/rpc/Shelly.GetDeviceInfo`);
        const info = await infoRes.json();
        shellyDeviceId = info.id || info.mac;
        // Auto-identify the sensor type from the device's reported model/app
        const detected = detectRole(info);
        setDetectedModel(info.model || info.app || info.id || '');
        if (detected) { setDeviceRole(detected); setRoleAutoDetected(true); }
        else { setRoleAutoDetected(false); }
      } catch (e) {
        console.warn('Could not fetch device info', e);
      }
      setShellyId(shellyDeviceId);

      // Cloud-alert webhooks: only when signed in and a worker URL is configured.
      const webhookBase = auth.currentUser ? (localStorage.getItem('sh_webhook_url') || DEFAULT_WORKER_URL) : '';
      if (webhookBase) {
        setStatusMessage('Setting up cloud alerts (2/3)...');
        try {
          const { registerShellyWebhooks } = await import('../utils/shellyRpc');
          const { shellyRpc } = await import('../utils/shellyRpc');
          const vid = (await import('../utils/VehicleManager')).getActiveVehicleId();
          await registerShellyWebhooks((m, p) => shellyRpc('192.168.33.1', m, p), webhookBase, vid, shellyDeviceId);
        } catch { /* best-effort */ }
      }

      setStatusMessage('Sending Wi-Fi Credentials (3/3)...');
      // 2. Setup Wi-Fi and reboot
      await unifiedFetch(`http://192.168.33.1/rpc/Wifi.SetConfig`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            sta: { ssid: ssid, pass: password, is_open: password.length === 0, enable: true }
          }
        })
      });
      
      // Confirm/override the (auto-detected) device type before adding it
      setStep('confirm_type');
    } catch (e: any) {
      setStatusMessage(`Error: ${e.message}. Are you connected to the Shelly AP?`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Finalize: persist the device locally using the confirmed role + detected id
  const finalizeAddDevice = async () => {
    const { addDevice } = await import('../utils/VehicleManager');
    addDevice({
      id: 'brv_sh_' + Math.random().toString(36).substr(2, 9),
      type: 'shelly_sensor',
      role: deviceRole,
      name: deviceRole,
      shellyDeviceId: shellyId,
      // Flood sensors are battery/sleepy → don't poll them (toggle in device settings for others).
      batteryPowered: deviceRole === 'Flood Sensor',
      // Manual-IP knows the address directly; BLE learns it from Wifi.GetStatus after the join.
      ...(method === 'manual_ip' && localIp ? { localIp } : {}),
      ...(method === 'bluetooth' && bleLocalIp ? { localIp: bleLocalIp } : {}),
      ...(method === 'bluetooth' && selectedBleDevice ? { bleMac: selectedBleDevice } : {}),
    });
    setStep('completion');
  };

  const executeManualIpProvisioning = async () => {
    setIsProcessing(true);
    setStatusMessage('Connecting to device…');
    try {
      const { shellyRpc } = await import('../utils/shellyRpc');
      // Try unauthenticated first; if the device has a password, shellyRpc digest-auths with
      // whatever the user typed (if anything).
      let info: any;
      try {
        info = await shellyRpc(localIp, 'Shelly.GetDeviceInfo', {}, shellyPassword || undefined);
      } catch (authErr: any) {
        const m = String(authErr?.message || authErr).toLowerCase();
        if (m.includes('password') || m.includes('401') || m.includes('auth') || m.includes('unauthor')) {
          setStatusMessage(
            shellyPassword
              ? '🔒 Wrong password. Re-enter the device password and retry — or factory reset the device and add it fresh via Wi-Fi.'
              : '🔒 This device is password-protected. Enter its password below and retry — or factory reset it and add it fresh via Wi-Fi.'
          );
          setIsProcessing(false);
          return;
        }
        throw authErr; // unreachable / wrong IP etc.
      }

      const shellyDeviceId = info.id || info.mac;
      const detected = detectRole(info);
      setDetectedModel(info.model || info.app || info.id || '');
      if (detected) { setDeviceRole(detected); setRoleAutoDetected(true); }
      else { setRoleAutoDetected(false); }
      setShellyId(shellyDeviceId);

      // Cloud-alert webhooks: only when signed in and a worker URL is configured.
      const webhookBase = auth.currentUser ? (localStorage.getItem('sh_webhook_url') || DEFAULT_WORKER_URL) : '';
      if (webhookBase) {
        setStatusMessage('Setting up cloud alerts…');
        try {
          const { registerShellyWebhooks } = await import('../utils/shellyRpc');
          const vid = (await import('../utils/VehicleManager')).getActiveVehicleId();
          await registerShellyWebhooks((m, p) => shellyRpc(localIp, m, p, shellyPassword || undefined), webhookBase, vid, shellyDeviceId);
        } catch { /* best-effort */ }
      }

      setStep('confirm_type');
    } catch (e: any) {
      setStatusMessage(`Error: ${e.message}. Ensure the IP is correct and on your network.`);
    } finally {
      setIsProcessing(false);
    }
  };

  const executeBluetoothProvisioning = async () => {
    const selectedDev = bleDevices.find(d => d.deviceId === selectedBleDevice);
    if (!selectedDev) { setStatusMessage('Select a device first.'); return; }
    setIsProcessing(true);
    setStatusMessage('Connecting & sending Wi-Fi over Bluetooth…');
    try {
      const { bleProvision } = await import('../utils/shellyBle');
      const webhookBase = auth.currentUser ? (localStorage.getItem('sh_webhook_url') || DEFAULT_WORKER_URL) : '';
      const vid = (await import('../utils/VehicleManager')).getActiveVehicleId();
      const { info, localIp, lastStatus } = await bleProvision(selectedDev.deviceId, { ssid, password, webhookBase: webhookBase || undefined, vid, onProgress: setStatusMessage });
      setBleLocalIp(localIp || '');
      setBleJoinStatus(localIp ? '' : (lastStatus || ''));

      // Auto-identify from the device's reported info (fall back to the advertised name).
      const detected = detectRole(info) ?? detectRole({ id: selectedDev.name, model: selectedDev.name });
      setDetectedModel(info?.model || info?.app || selectedDev.name || '');
      if (detected) { setDeviceRole(detected); setRoleAutoDetected(true); }
      else { setRoleAutoDetected(false); }
      setShellyId(info?.id || info?.mac || selectedDev.name);

      setStep('confirm_type');
    } catch (e: any) {
      setStatusMessage(`Bluetooth setup failed: ${e?.message || e}. Make sure the device is powered and nearby.`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(5px)',
      display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
    }}>
      <div className="glass-card" style={{ width: '100%', maxWidth: '500px', padding: '30px', position: 'relative', maxHeight: '90vh', overflowY: 'auto' }}>
        <button onClick={onClose} style={{
          position: 'absolute', top: '15px', right: '15px', background: 'none', border: 'none',
          color: '#fff', fontSize: '1.5rem', cursor: 'pointer'
        }}>×</button>

        <h2 style={{ marginTop: 0, color: 'var(--accent-cyan)', marginBottom: '20px' }}>Add Shelly Device</h2>

        {step === 'selection' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '10px' }}>How would you like to set up your device?</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              {/* Bluetooth (native mobile only) is the recommended path there; it's first. */}
              {bleSupported && (
                <button className="btn-secondary" onClick={() => handleSelectMethod('bluetooth')} style={{ padding: '15px', textAlign: 'left', background: 'rgba(59, 130, 246, 0.2)', border: '1px solid #3b82f6' }}>
                  <strong style={{ display: 'block', fontSize: '1.1rem' }}>📱 Set up via Bluetooth (Recommended)</strong>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Best for a brand-new device — no need to switch Wi-Fi networks.</span>
                </button>
              )}

              <button className="btn-secondary" onClick={() => handleSelectMethod('wifi')} style={{ padding: '15px', textAlign: 'left', background: !bleSupported ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.05)', border: !bleSupported ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)' }}>
                <strong style={{ display: 'block', fontSize: '1.1rem' }}>📡 Set up via Wi-Fi AP {!bleSupported && '(Recommended)'}</strong>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>For a brand-new device — join its Wi-Fi hotspot to configure it.</span>
              </button>
            </div>

            <button className="btn-secondary" onClick={() => handleSelectMethod('manual_ip')} style={{ padding: '15px', textAlign: 'left', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <strong style={{ display: 'block', fontSize: '1.1rem' }}>⚙️ Existing Device (Manual IP)</strong>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>For devices already connected to your Wi-Fi.</span>
            </button>
            {/* Device type is auto-detected from the device and confirmed at the end — no need to ask here. */}
          </div>
        )}

        {step === 'ble_scanning' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <h3 style={{ margin: 0, color: '#fff' }}>Bluetooth Discovery</h3>
            
            {isProcessing ? (
              <div style={{ textAlign: 'center', padding: '30px 0' }}>
                <p style={{ color: 'var(--accent-cyan)' }}>{statusMessage}</p>
                <div style={{ marginTop: '15px' }}>
                  {/* Mock spinner */}
                  <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', fontSize: '2rem' }}>⚙️</span>
                  <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
                </div>
              </div>
            ) : (
              <>
                <p style={{ color: 'var(--text-secondary)' }}>Select your Shelly device from the list below:</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {bleDevices.map(d => (
                    <button
                      key={d.deviceId}
                      className={selectedBleDevice === d.deviceId ? "btn-primary" : "btn-secondary"}
                      onClick={() => setSelectedBleDevice(d.deviceId)}
                      style={{ padding: '12px', textAlign: 'left' }}
                    >
                      {d.name}
                    </button>
                  ))}
                  {bleDevices.length === 0 && (
                    <div style={{ color: '#fde68a', fontSize: '0.85rem' }}>
                      {statusMessage || 'No Shelly devices found. Make sure the device is powered, nearby, and that you granted the Bluetooth permission.'}
                    </div>
                  )}
                </div>

                <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                  <button className="btn-secondary" onClick={() => setStep('selection')}>Back</button>
                  <button className="btn-secondary" onClick={startBleScan}>🔄 Rescan</button>
                  <button className="btn-primary" onClick={() => { setStatusMessage(''); setStep('credentials'); }} disabled={!selectedBleDevice}>Next Step</button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 'credentials' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            {method === 'wifi' && (
              <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid #f59e0b', padding: '12px', borderRadius: '8px' }}>
                <strong style={{ color: '#f59e0b', display: 'block', marginBottom: '6px' }}>First, join the Shelly's Wi-Fi</strong>
                <ol style={{ margin: 0, paddingLeft: '18px', color: '#fff', fontSize: '0.85rem', lineHeight: 1.5 }}>
                  <li>Open your phone/computer Wi-Fi settings and connect to the Shelly hotspot (e.g. <code>shellyplus...-xxxx</code>).</li>
                  {isMobile && <li><strong>Turn off mobile data</strong> so this can reach the device, then come back.</li>}
                  <li>Then <strong>Scan</strong> below (or type your home network) and tap <strong>Connect &amp; Arm</strong>.</li>
                </ol>
              </div>
            )}
            <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
              {method === 'bluetooth' ? 'Enter the Wi-Fi network the device should join (sent over Bluetooth).' : 'Enter the Wi-Fi details for your Boat/RV network (the device will join this).'}
            </p>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="form-label">Wi-Fi Network Name (SSID)</label>
                <button
                  className="btn-secondary"
                  onClick={handleScanWifi}
                  disabled={isScanningWifi || (method === 'bluetooth' && !selectedBleDevice)}
                  style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                >
                  {isScanningWifi ? 'Scanning…' : '📡 Scan'}
                </button>
              </div>
              {wifiScanResults.length > 0 ? (
                <select className="form-input" value={ssid} onChange={e => setSsid(e.target.value)}>
                  {!wifiScanResults.some(r => r.ssid === ssid) && <option value={ssid}>{ssid || 'Select a network…'}</option>}
                  {wifiScanResults.map(r => (
                    <option key={r.ssid} value={r.ssid}>{r.ssid} ({r.rssi} dBm)</option>
                  ))}
                </select>
              ) : (
                <input className="form-input" type="text" value={ssid} onChange={e => setSsid(e.target.value)} placeholder="e.g. BoatNetwork" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
              )}
              {wifiScanResults.length > 0 && (
                <button
                  onClick={() => setWifiScanResults([])}
                  style={{ background: 'none', border: 'none', color: 'var(--accent-cyan)', fontSize: '0.75rem', cursor: 'pointer', padding: '4px 0 0 0' }}
                >
                  Enter manually instead
                </button>
              )}
              {wifiScanMsg && <div style={{ color: '#fde68a', fontSize: '0.78rem', marginTop: '6px' }}>{wifiScanMsg}</div>}
            </div>
            <div>
              <label className="form-label">Wi-Fi Password</label>
              <div style={{ position: 'relative' }}>
                <input className="form-input" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" style={{ paddingRight: '44px', width: '100%' }} />
                <button type="button" onClick={() => setShowPassword(s => !s)} aria-label={showPassword ? 'Hide password' : 'Show password'}
                  style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '4px' }}>
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>
            {statusMessage && <div style={{ color: statusMessage.toLowerCase().includes('fail') || statusMessage.includes('Error') ? '#ef4444' : 'var(--accent-cyan)', fontSize: '0.85rem', textAlign: 'center' }}>{statusMessage}</div>}
            <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between' }}>
              <button className="btn-secondary" onClick={() => setStep(method === 'bluetooth' ? 'ble_scanning' : 'selection')} disabled={isProcessing}>Back</button>
              {method === 'bluetooth' ? (
                <button className="btn-primary" onClick={executeBluetoothProvisioning} disabled={!ssid || isProcessing}>
                  {isProcessing ? 'Sending…' : '📱 Send over Bluetooth'}
                </button>
              ) : (
                <button className="btn-primary" onClick={executeWifiProvisioning} disabled={!ssid || isProcessing}>
                  {isProcessing ? 'Configuring…' : 'Connect & Arm'}
                </button>
              )}
            </div>
          </div>
        )}

        {step === 'ip_entry' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '10px' }}>Enter the local IP address of your Shelly device on the network.</p>
            <div>
              <label className="form-label">Local IP Address</label>
              <input className="form-input" type="text" value={localIp} onChange={e => setLocalIp(e.target.value)} placeholder="e.g. 192.168.1.50" />
            </div>
            <div>
              <label className="form-label">Shelly Device Password (Optional)</label>
              <div style={{ position: 'relative' }}>
                <input className="form-input" type={showShellyPassword ? 'text' : 'password'} value={shellyPassword} onChange={e => setShellyPassword(e.target.value)} placeholder="Leave blank if no auth enabled" style={{ paddingRight: '44px', width: '100%' }} />
                <button type="button" onClick={() => setShowShellyPassword(s => !s)} aria-label={showShellyPassword ? 'Hide password' : 'Show password'}
                  style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '4px' }}>
                  {showShellyPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>
            
            {statusMessage && <div style={{ color: '#ef4444', fontSize: '0.9rem', marginTop: '10px' }}>{statusMessage}</div>}
            
            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between' }}>
              <button className="btn-secondary" onClick={() => setStep('selection')} disabled={isProcessing}>Back</button>
              <button className="btn-primary" onClick={executeManualIpProvisioning} disabled={!localIp || isProcessing}>
                {isProcessing ? 'Configuring...' : 'Configure Device'}
              </button>
            </div>
          </div>
        )}

        {step === 'provisioning' && method === 'wifi' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid #f59e0b', padding: '15px', borderRadius: '8px' }}>
              <h4 style={{ color: '#f59e0b', margin: '0 0 10px 0' }}>Action Required</h4>
              <ol style={{ margin: 0, paddingLeft: '20px', color: '#fff', fontSize: '0.95rem' }}>
                <li>Open your computer/phone Wi-Fi settings.</li>
                <li>Connect to the Shelly's network (usually <code>shellyplusuni-xxxx</code>).</li>
                <li>Once connected, click "Connect & Arm" below.</li>
              </ol>
            </div>
            
            {statusMessage && <div style={{ color: statusMessage.includes('Error') ? '#ef4444' : 'var(--accent-cyan)', fontSize: '0.9rem', marginTop: '10px', textAlign: 'center' }}>{statusMessage}</div>}

            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between' }}>
              <button className="btn-secondary" onClick={() => setStep('credentials')} disabled={isProcessing}>Back</button>
              <button className="btn-primary" onClick={executeWifiProvisioning} disabled={isProcessing}>
                {isProcessing ? 'Processing...' : 'Connect & Arm'}
              </button>
            </div>
          </div>
        )}

        {step === 'provisioning' && method === 'bluetooth' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '10px' }}>Provisioning device over Bluetooth LE...</p>
            
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <p style={{ color: 'var(--accent-cyan)' }}>{statusMessage}</p>
              <div style={{ marginTop: '15px' }}>
                <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', fontSize: '2rem' }}>⚙️</span>
              </div>
            </div>

            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between' }}>
              <button className="btn-secondary" onClick={() => setStep('credentials')} disabled={isProcessing}>Back</button>
              <button className="btn-primary" onClick={executeBluetoothProvisioning} disabled={isProcessing}>
                {isProcessing ? 'Processing...' : 'Start Provisioning'}
              </button>
            </div>
          </div>
        )}

        {step === 'confirm_type' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <h3 style={{ margin: 0, color: '#fff' }}>Confirm Device Type</h3>
            {detectedModel && (
              <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.9rem' }}>
                Detected hardware: <strong style={{ color: 'var(--accent-cyan)' }}>{detectedModel}</strong>
              </p>
            )}
            {method === 'bluetooth' && (
              bleLocalIp
                ? <p style={{ color: '#10b981', margin: 0, fontSize: '0.85rem' }}>✓ Joined Wi-Fi — local IP <strong>{bleLocalIp}</strong> (will poll locally).</p>
                : bleJoinStatus === 'connecting'
                  ? <p style={{ color: '#ef4444', margin: 0, fontSize: '0.85rem' }}>⚠️ The device sees your network but couldn't authenticate — this is almost always a <strong>wrong Wi-Fi password</strong>. Go Back, re-enter the password (tap 👁️ to verify), and resend.</p>
                  : <p style={{ color: '#fde68a', margin: 0, fontSize: '0.85rem' }}>⚠️ Couldn't confirm the Wi-Fi join over Bluetooth (status: {bleJoinStatus || 'unknown'}). The device may still be connecting; you can set its Local IP later in device settings.</p>
            )}
            <div>
              <label className="form-label">
                Sensor type {roleAutoDetected ? '(auto-detected — change if wrong)' : '(please confirm)'}
              </label>
              <select className="form-input" value={deviceRole} onChange={(e) => { setDeviceRole(e.target.value); setRoleAutoDetected(false); }}>
                <option value="High Power Sensor">High Power Sensor (120v/240v)</option>
                <option value="Low Power Sensor">Low Power Sensor (10-26v)</option>
                <option value="Flood Sensor">Flood Sensor</option>
              </select>
              {roleAutoDetected && (
                <div style={{ color: '#a7f3d0', fontSize: '0.78rem', marginTop: '6px' }}>
                  ✓ We identified this device as a <strong>{deviceRole}</strong>. Adjust above if that's not right.
                </div>
              )}
            </div>
            <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn-primary" onClick={finalizeAddDevice}>Add Device</button>
            </div>
          </div>
        )}

        {step === 'completion' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: '4rem', marginBottom: '10px' }}>✅</div>
            <h3 style={{ color: '#10b981', margin: '0 0 10px 0' }}>Device Armed!</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>
              Your device has been successfully configured to send critical alerts. 
              {method === 'wifi' && " Don't forget to reconnect your computer/phone back to your normal Boat/RV Wi-Fi."}
            </p>
            <button className="btn-primary" onClick={onClose} style={{ width: '100%', padding: '12px' }}>Done</button>
          </div>
        )}

      </div>
    </div>
  );
}
