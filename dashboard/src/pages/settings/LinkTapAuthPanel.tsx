// LinkTap Auth panel (Settings → Devices → Advanced Options). Cloud sign-in + local gateway control +
// TapLinker device IDs. Signing in fetches a LinkTap API key under the hood to stay connected — that's
// an implementation detail the UI hides; to the user it's just "sign in / sign out of LinkTap Cloud".

import { useState } from 'react';

type Msg = { text: string; type: 'success' | 'error' } | null;
type ConnectionStatus = 'connected' | 'disconnected' | 'mock' | 'connecting';

interface Props {
  connectionStatus: ConnectionStatus;
  isCloudPollingActive: boolean;
  setIsCloudPollingActive: (v: boolean) => void;
  isLocalPollingActive: boolean;
  setIsLocalPollingActive: (v: boolean) => void;
  cloudUsername: string;
  setCloudUsername: (v: string) => void;
  cloudApiKey: string;
  setCloudApiKey: (v: string) => void;
  // Username + password → LinkTap getApiKey (the key is fetched, never pasted by hand).
  cloudPassword: string;
  setCloudPassword: (v: string) => void;
  showCloudPassword: boolean;
  setShowCloudPassword: (v: boolean) => void;
  handleGetApiKey: (replace: boolean) => void;
  /** Forget the stored API key + username and disconnect (log out of the LinkTap account). */
  handleDisconnectAccount: () => void;
  isFetchingKey: boolean;
  keyMsg: Msg;
  handleRetrieveFromCloud: () => void;
  isDiscovering: boolean;
  discoveryMsg: Msg;
  gatewayIp: string;
  setGatewayIp: (v: string) => void;
  handleScanGateway: () => void;
  isScanningGateway: boolean;
  scanMsg: Msg;
  setScanMsg: (v: Msg) => void;
  scanResults: string[];
  setScanResults: (v: string[]) => void;
  gatewayId: string;
  setGatewayId: (v: string) => void;
  cloudGateways: { id: string; name: string }[];
  gatewayIdManual: boolean;
  setGatewayIdManual: (v: boolean) => void;
  primaryDeviceId: string;
  setPrimaryDeviceId: (v: string) => void;
  secondaryDeviceId: string;
  setSecondaryDeviceId: (v: string) => void;
  cloudTaplinkers: { id: string; name: string; gatewayId: string }[];
  device1Manual: boolean;
  setDevice1Manual: (v: boolean) => void;
  device2Manual: boolean;
  setDevice2Manual: (v: boolean) => void;
}

export default function LinkTapAuthPanel(p: Props) {
  // Inline two-tap confirm for sign-out. window.confirm() is a no-op in the Tauri webview (that's why
  // the old delete button "couldn't be clicked"), so we never use it.
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>LinkTap Credentials</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={`status-dot ${p.connectionStatus === 'connected' ? 'online' : p.connectionStatus}`}></span>
          <span style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>
            {p.connectionStatus === 'connected' ?
              (p.isCloudPollingActive && p.isLocalPollingActive ? 'CLOUD & LOCAL CONNECTED' :
              p.isCloudPollingActive ? 'CLOUD ONLY CONNECTED' :
              p.isLocalPollingActive ? 'LOCAL ONLY CONNECTED' : 'CONNECTED') :
             p.connectionStatus === 'connecting' ? 'CONNECTING...' : ''}
          </span>
        </div>
      </div>

      <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent-cyan)', margin: 0 }}>☁️ Cloud Controller</h4>
              {p.cloudApiKey && p.isCloudPollingActive && (
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent-emerald)' }}>● Connected</span>
              )}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
              Signing in connects the app to your LinkTap account so it can read valve state and control
              the valve when you're away from the boat's network. (Alert webhooks are separate — the
              server manages those.)
            </div>
            <div><label className="form-label">Cloud Username</label><input type="text" className="form-input" value={p.cloudUsername} onChange={(e) => { p.setCloudUsername(e.target.value); p.setIsCloudPollingActive(false); }} placeholder="Your LinkTap account username" autoComplete="username" /></div>
            <div>
              <label className="form-label">Cloud Password</label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input type={p.showCloudPassword ? 'text' : 'password'} className="form-input" value={p.cloudPassword} onChange={(e) => p.setCloudPassword(e.target.value)} placeholder="Your LinkTap account password" autoComplete="current-password" autoCapitalize="off" autoCorrect="off" style={{ paddingRight: '40px' }} />
                <button
                  className="btn-secondary"
                  onClick={() => p.setShowCloudPassword(!p.showCloudPassword)}
                  title={p.showCloudPassword ? 'Hide password' : 'Show password'}
                  style={{ position: 'absolute', right: '8px', background: 'transparent', border: 'none', padding: '4px', cursor: 'pointer', opacity: 0.6 }}
                >
                  {p.showCloudPassword ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>Used only to sign in — never stored.</div>
            </div>
            <button
              className="btn-primary"
              onClick={() => p.handleGetApiKey(false)}
              disabled={p.isFetchingKey || !p.cloudUsername || !p.cloudPassword}
              style={{ padding: '8px 14px', fontSize: '0.85rem', fontWeight: 700 }}
            >
              {p.isFetchingKey ? 'Signing in…' : '🔑 Login to LinkTap Cloud'}
            </button>
            {p.keyMsg && (
              <div style={{ fontSize: '0.8rem', color: p.keyMsg.type === 'success' ? 'var(--accent-emerald)' : 'var(--accent-orange)' }}>
                {p.keyMsg.text}
              </div>
            )}

            {p.cloudApiKey ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--accent-emerald)', fontWeight: 700 }}>
                  ✓ Signed in to LinkTap Cloud{p.cloudUsername ? ` as ${p.cloudUsername}` : ''}
                </div>
                <button
                  className="btn-secondary"
                  onClick={() => { if (confirmSignOut) { p.handleDisconnectAccount(); setConfirmSignOut(false); } else setConfirmSignOut(true); }}
                  onBlur={() => setConfirmSignOut(false)}
                  style={{ padding: '6px 12px', fontSize: '0.78rem', alignSelf: 'flex-start', color: '#ef4444' }}
                >
                  {confirmSignOut ? 'Tap again to confirm sign out' : '🗑️ Sign out of LinkTap Cloud'}
                </button>
              </div>
            ) : (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                Enter your LinkTap account username and password to sign in — cloud control and device
                discovery turn on automatically.
              </div>
            )}
          </div>

          {/* Retrieve devices from cloud — shared discovery action, centered between the two controllers */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button
              className="btn-secondary"
              onClick={p.handleRetrieveFromCloud}
              disabled={p.isDiscovering || !p.cloudUsername || !p.cloudApiKey}
              style={{ padding: '8px 18px', fontSize: '0.8rem' }}
            >
              {p.isDiscovering ? 'Retrieving...' : '⬇️ Retrieve Devices from Cloud'}
            </button>
          </div>

          {/* Local Gateway Control */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent-emerald)', margin: 0 }}>🏠 Local Gateway Control</h4>
              <button
                className={!p.isLocalPollingActive ? "btn-primary" : "btn-secondary"}
                onClick={() => p.setIsLocalPollingActive(!p.isLocalPollingActive)}
                disabled={!p.gatewayIp}
                title={!p.gatewayIp ? 'Enter or scan for a Gateway IP first' : ''}
                style={{ padding: '4px 12px', fontSize: '0.75rem', fontWeight: 700 }}
              >
                {!p.isLocalPollingActive ? 'Connect Locally' : '✓ Connected Locally'}
              </button>
            </div>

            {p.discoveryMsg && (
              <div style={{ fontSize: '0.8rem', color: p.discoveryMsg.type === 'success' ? 'var(--accent-emerald)' : 'var(--accent-orange)' }}>
                {p.discoveryMsg.text}
              </div>
            )}

            {/* Gateway IP */}
            <div>
              <label className="form-label">Gateway IP</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input type="text" className="form-input" value={p.gatewayIp}
                  onChange={(e) => { p.setGatewayIp(e.target.value); p.setScanResults([]); }}
                  placeholder="e.g. 192.168.1.100" style={{ flex: 1 }} />
                <button className="btn-secondary" onClick={p.handleScanGateway} disabled={p.isScanningGateway}
                  style={{ padding: '8px 12px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                  {p.isScanningGateway ? '⏳ Scanning subnet...' : '🔍 Scan for Gateway'}
                </button>
              </div>
              {p.scanMsg && (
                <div style={{ fontSize: '0.75rem', color: p.scanMsg.type === 'success' ? 'var(--accent-emerald)' : 'var(--accent-orange)', marginTop: '4px' }}>
                  {p.scanMsg.text}
                </div>
              )}
              {p.scanResults.length > 1 && (
                <select className="form-input" style={{ marginTop: '8px' }}
                  value={p.gatewayIp}
                  onChange={(e) => { p.setGatewayIp(e.target.value); p.setScanResults([]); p.setScanMsg(null); }}>
                  <option value="">— Select a gateway —</option>
                  {p.scanResults.map(ip => (
                    <option key={ip} value={ip}>{ip}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Gateway ID */}
            <div>
              <label className="form-label">Gateway ID</label>
              {p.cloudGateways.length > 0 && !p.gatewayIdManual ? (
                <select className="form-input" value={p.gatewayId}
                  onChange={(e) => {
                    if (e.target.value === '__manual__') { p.setGatewayIdManual(true); }
                    else p.setGatewayId(e.target.value);
                  }}>
                  <option value="">— Select a Gateway —</option>
                  {p.cloudGateways.map(gw => (
                    <option key={gw.id} value={gw.id}>{gw.name !== gw.id ? `${gw.name} (${gw.id})` : gw.id}</option>
                  ))}
                  <option value="__manual__">✏️ Enter manually...</option>
                </select>
              ) : (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input type="text" className="form-input" value={p.gatewayId}
                    onChange={(e) => p.setGatewayId(e.target.value)}
                    placeholder="16-char hex Gateway ID" style={{ flex: 1 }} />
                  {p.cloudGateways.length > 0 && (
                    <button className="btn-secondary" onClick={() => p.setGatewayIdManual(false)}
                      style={{ padding: '6px 10px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>← List</button>
                  )}
                </div>
              )}
            </div>

            {/* Device IDs */}
            {p.primaryDeviceId && p.secondaryDeviceId && p.primaryDeviceId === p.secondaryDeviceId && (
              <div style={{ fontSize: '0.8rem', color: 'var(--accent-orange)', background: 'rgba(251,146,60,0.1)', border: '1px solid rgba(251,146,60,0.3)', borderRadius: '8px', padding: '8px 12px' }}>
                ⚠️ Device ID 1 and Device ID 2 are the same — each field must reference a different TapLinker.
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label className="form-label">TapLinker Device ID 1</label>
                {p.cloudTaplinkers.length > 0 && !p.device1Manual ? (
                  <select className="form-input" value={p.primaryDeviceId}
                    onChange={(e) => {
                      if (e.target.value === '__manual__') { p.setDevice1Manual(true); }
                      else p.setPrimaryDeviceId(e.target.value);
                    }}>
                    <option value="">— Select a Device —</option>
                    {p.cloudTaplinkers.filter(tap => tap.id !== p.secondaryDeviceId).map(tap => (
                      <option key={tap.id} value={tap.id}>{tap.name !== tap.id ? `${tap.name} (${tap.id})` : tap.id}</option>
                    ))}
                    <option value="__manual__">✏️ Enter manually...</option>
                  </select>
                ) : (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input type="text" className="form-input" value={p.primaryDeviceId}
                      onChange={(e) => p.setPrimaryDeviceId(e.target.value)}
                      placeholder="16-char hex Device ID" style={{ flex: 1 }} />
                    {p.cloudTaplinkers.length > 0 && (
                      <button className="btn-secondary" onClick={() => p.setDevice1Manual(false)}
                        style={{ padding: '6px 10px', fontSize: '0.8rem' }}>← List</button>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label className="form-label">TapLinker Device ID 2</label>
                {p.cloudTaplinkers.length > 0 && !p.device2Manual ? (
                  <select className="form-input" value={p.secondaryDeviceId}
                    onChange={(e) => {
                      if (e.target.value === '__manual__') { p.setDevice2Manual(true); }
                      else p.setSecondaryDeviceId(e.target.value);
                    }}>
                    <option value="">— Select a Device (optional) —</option>
                    {p.cloudTaplinkers.filter(tap => tap.id !== p.primaryDeviceId).map(tap => (
                      <option key={tap.id} value={tap.id}>{tap.name !== tap.id ? `${tap.name} (${tap.id})` : tap.id}</option>
                    ))}
                    <option value="__manual__">✏️ Enter manually...</option>
                  </select>
                ) : (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input type="text" className="form-input" value={p.secondaryDeviceId}
                      onChange={(e) => p.setSecondaryDeviceId(e.target.value)}
                      placeholder="16-char hex (optional)" style={{ flex: 1 }} />
                    {p.cloudTaplinkers.length > 0 && (
                      <button className="btn-secondary" onClick={() => p.setDevice2Manual(false)}
                        style={{ padding: '6px 10px', fontSize: '0.8rem' }}>← List</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
    </div>
  );
}
