// "🩺 Scan for issues" — per-device health check inside the Configuration ⚙️ panel. Runs the
// deviceDiagnostics scan (reachability, password, voltmeter, webhook health, IP drift, LinkTap
// config) and renders the findings. Self-contained on purpose: the scan is device-scoped and touches
// none of Settings' state, so DeviceConfigPanel stays presentational — it just mounts this with the
// device + resolved local host.

import { useState } from 'react';
import type { DeviceConfig } from '../utils/VehicleManager';
import { scanDevice, type DeviceIssue } from '../utils/deviceDiagnostics';
import { shellyRpc } from '../utils/shellyRpc';
import { updateDevice } from '../utils/VehicleManager';
import { DEFAULT_WORKER_URL } from '../utils/configSync';
import { auth } from '../services/firebase';

const SEVERITY_UI: Record<DeviceIssue['severity'], { icon: string; color: string }> = {
  error: { icon: '⛔', color: '#ef4444' },
  warn: { icon: '⚠️', color: 'var(--accent-orange)' },
  info: { icon: 'ℹ️', color: 'var(--text-secondary)' },
  ok: { icon: '✅', color: 'var(--accent-emerald)' },
};

export default function DeviceScanPanel({ device, host }: { device: DeviceConfig; host?: string }) {
  const [scanning, setScanning] = useState(false);
  const [issues, setIssues] = useState<DeviceIssue[] | null>(null);

  const runScan = async () => {
    setScanning(true);
    setIssues(null);
    try {
      const password = localStorage.getItem('sh_local_password') || undefined;
      const results = await scanDevice(device, host, {
        rpc: (h, m, p) => shellyRpc(h, m, p, password),
        ctx: {
          webhookBase: localStorage.getItem('sh_webhook_url') || DEFAULT_WORKER_URL,
          // Read-only: don't mint a secret from a diagnostic (ensureWebhookSecret would).
          webhookSecret: localStorage.getItem('sh_webhook_secret') || '',
          signedIn: !!auth.currentUser,
        },
        linktap: {
          cloudUser: localStorage.getItem('lt_cloud_user') || '',
          cloudKey: localStorage.getItem('lt_cloud_key') || '',
          gatewayId: localStorage.getItem('lt_gateway_id') || '',
        },
      });
      setIssues(results);
      // The scan just talked to the device, so trust its reported address: fix a stale stored IP
      // immediately (the same self-heal the cloud &ip= tracker does asynchronously).
      const stale = results.find((r) => r.title === 'Stored IP is stale');
      const m = stale?.detail.match(/now at (\d{1,3}(?:\.\d{1,3}){3})/);
      if (m) updateDevice(device.id, { localIp: m[1] });
    } catch (e: any) {
      setIssues([{ severity: 'error', title: 'Scan failed', detail: e?.message || String(e) }]);
    } finally {
      setScanning(false);
    }
  };

  const problems = (issues || []).filter((i) => i.severity !== 'ok');

  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div>
          <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>Health Check</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            {issues === null
              ? 'Checks connectivity, password, sensors, and cloud-alert wiring.'
              : problems.length === 0
                ? 'No issues found.'
                : `${problems.length} issue${problems.length === 1 ? '' : 's'} found.`}
          </div>
        </div>
        <button className="btn-secondary" disabled={scanning} onClick={runScan}
          style={{ padding: '6px 12px', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
          {scanning ? 'Scanning…' : '🩺 Scan for issues'}
        </button>
      </div>
      {issues && issues.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {issues.map((iss, idx) => (
            <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '0.8rem' }}>
              <span aria-hidden>{SEVERITY_UI[iss.severity].icon}</span>
              <div>
                <span style={{ fontWeight: 700, color: SEVERITY_UI[iss.severity].color }}>{iss.title}</span>
                <span style={{ color: 'var(--text-secondary)' }}> — {iss.detail}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
