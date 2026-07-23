import { useEffect, useState } from 'react';
import { getActiveVehicleId } from '../../utils/VehicleManager';
import { loadVehicleWifi, saveVehicleWifi, clearVehicleWifi, canManageWifi, maskSecret } from '../../utils/vehicleWifi';
import { formatDateTime } from '../../utils/time';

// Settings → Vehicle: the remembered Wi-Fi network used to prefill device provisioning.
// Self-contained (reads/writes localStorage directly) so it doesn't thread yet more props through
// Settings.tsx. Credentials are device-local and never synced — see utils/vehicleWifi for why.

export default function VehicleWifiPanel() {
  const [vid, setVid] = useState(() => getActiveVehicleId() || '');
  const [saved, setSaved] = useState(() => loadVehicleWifi(getActiveVehicleId() || ''));
  const [role, setRole] = useState(() => localStorage.getItem('lt_my_role'));
  const [editing, setEditing] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const refresh = () => {
      const next = getActiveVehicleId() || '';
      setVid(next);
      setSaved(loadVehicleWifi(next));
      setRole(localStorage.getItem('lt_my_role'));
      setReveal(false);
    };
    window.addEventListener('settings_updated', refresh);
    window.addEventListener('role_updated', refresh);
    return () => {
      window.removeEventListener('settings_updated', refresh);
      window.removeEventListener('role_updated', refresh);
    };
  }, []);

  const allowed = canManageWifi(role);

  const startEdit = () => {
    setSsid(saved?.ssid || '');
    setPassword(saved?.password || '');
    setEditing(true);
    setMsg('');
  };

  const save = () => {
    saveVehicleWifi(vid, ssid, password);
    setSaved(loadVehicleWifi(vid));
    setEditing(false);
    setReveal(false);
    setMsg(ssid.trim() ? 'Saved on this device.' : 'Network forgotten.');
  };

  const forget = () => {
    clearVehicleWifi(vid);
    setSaved(null);
    setEditing(false);
    setReveal(false);
    setMsg('Network forgotten.');
  };

  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div>
        <h3 style={{ marginTop: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', margin: '0 0 4px 0' }}>
          Vehicle Wi-Fi
        </h3>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Remembered so adding a sensor prefills the network instead of retyping it. Stored on this device
          only — never uploaded to the cloud, and not visible to people you share this vehicle with.
        </p>
      </div>

      {!allowed ? (
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          Only an admin or a monitor-and-control member can manage the vehicle's network credentials.
        </p>
      ) : editing ? (
        <>
          <div>
            <label className="form-label">Network name (SSID)</label>
            <input
              className="form-input" value={ssid} onChange={(e) => setSsid(e.target.value)}
              placeholder="e.g. BoatNetwork" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            />
          </div>
          <div>
            <label className="form-label">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                className="form-input" type={reveal ? 'text' : 'password'} value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off"
                style={{ paddingRight: '44px', width: '100%' }}
              />
              <button
                type="button" onClick={() => setReveal((r) => !r)}
                aria-label={reveal ? 'Hide password' : 'Show password'}
                style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '4px' }}
              >
                {reveal ? '🙈' : '👁️'}
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button className="btn-primary" onClick={save} style={{ padding: '8px 16px', fontSize: '0.85rem' }}>Save</button>
            <button className="btn-secondary" onClick={() => { setEditing(false); setReveal(false); }} style={{ padding: '8px 16px', fontSize: '0.85rem' }}>Cancel</button>
          </div>
        </>
      ) : saved ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.95rem', color: '#fff' }}>📶 {saved.ssid}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {reveal ? (saved.password || '(open network)') : maskSecret(saved.password) || '(open network)'}
                {saved.savedAt ? ` · saved ${formatDateTime(saved.savedAt)}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button className="btn-secondary" onClick={() => setReveal((r) => !r)} style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
                {reveal ? '🙈 Hide' : '👁️ Reveal'}
              </button>
              <button className="btn-secondary" onClick={startEdit} style={{ padding: '6px 12px', fontSize: '0.8rem' }}>Edit</button>
              <button className="btn-secondary" onClick={forget} style={{ padding: '6px 12px', fontSize: '0.8rem', border: '1px solid rgba(239,68,68,0.5)', color: '#ef4444' }}>Forget</button>
            </div>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>No network saved for this vehicle yet.</span>
          <button className="btn-secondary" onClick={startEdit} style={{ padding: '6px 12px', fontSize: '0.8rem' }}>+ Save a network</button>
        </div>
      )}

      {msg && <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--accent-cyan)' }}>{msg}</p>}
    </div>
  );
}
