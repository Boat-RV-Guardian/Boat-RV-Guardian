// "🩺 Scan for issues" — per-device health check inside the Configuration ⚙️ panel. Runs the
// deviceDiagnostics scan (reachability, password, voltmeter, webhook health, IP drift, LinkTap
// config), renders the findings, and offers one-tap FIXES for the ones the app can remediate
// itself (each fix maps to an existing, proven helper — no new device-mutation paths). After a fix
// it automatically rescans so the finding visibly flips to ✅. Self-contained on purpose: the scan
// is device-scoped and touches none of Settings' state, so DeviceConfigPanel stays presentational.

import { useState } from 'react';
import type { DeviceConfig } from '../utils/VehicleManager';
import { scanDevice, type DeviceIssue, type FixAction } from '../utils/deviceDiagnostics';
import { shellyRpc, shellyChangePassword, enableShellyVoltmeter, refreshCloudShellyWebhooks } from '../utils/shellyRpc';
import { unifiedFetch } from '../utils/linktapHttp';
import { updateDevice, getActiveVehicleId } from '../utils/VehicleManager';
import { DEFAULT_WORKER_URL } from '../utils/configSync';
import { ensureWebhookSecret } from '../utils/webhookSecret';
import { auth } from '../services/firebase';

const SEVERITY_UI: Record<DeviceIssue['severity'], { icon: string; color: string }> = {
  error: { icon: '⛔', color: '#ef4444' },
  warn: { icon: '⚠️', color: 'var(--accent-orange)' },
  info: { icon: 'ℹ️', color: 'var(--text-secondary)' },
  ok: { icon: '✅', color: 'var(--accent-emerald)' },
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function DeviceScanPanel({ device, host }: { device: DeviceConfig; host?: string }) {
  const [scanning, setScanning] = useState(false);
  const [fixing, setFixing] = useState<FixAction | null>(null);
  const [fixMsg, setFixMsg] = useState<string | null>(null);
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
          gatewayIp: localStorage.getItem('lt_gateway_ip') || '',
        },
        // LAN reachability: hit the gateway's local API with a short timeout (same transport the
        // widget polls with). Any parseable response ⇒ reachable.
        linktapProbe: async () => {
          const ip = localStorage.getItem('lt_gateway_ip') || '';
          if (!ip) return false;
          try {
            const res = await unifiedFetch(`http://${ip}/api.shtml`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cmd: 3, gw_id: localStorage.getItem('lt_gateway_id') || '', dev_id: localStorage.getItem('lt_device_id') || '' }),
              timeout: 4000,
            });
            await res.text();
            return true;
          } catch { return false; }
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

  // One-tap remediation. Each action reuses the exact helper the normal flows use (Settings
  // password push, voltmeter enable, webhook self-heal) so a Fix can't diverge from them.
  const runFix = async (action: FixAction) => {
    if (!host && device.type === 'shelly_sensor') return;
    setFixing(action);
    setFixMsg(null);
    const password = localStorage.getItem('sh_local_password') || undefined;
    const call = (m: string, p: any) => shellyRpc(host!, m, p, password);
    try {
      let rescanDelayMs = 1500; // give the device a beat before re-probing
      if (action === 'set_password') {
        const vehiclePw = localStorage.getItem('sh_local_password') || '';
        if (!vehiclePw) throw new Error('This vehicle has no Shelly local password yet — set one in Settings → General first.');
        setFixMsg('Setting the vehicle password on the device…');
        await shellyChangePassword(host!, device.shellyDeviceId || '', vehiclePw, vehiclePw);
      } else if (action === 'enable_voltmeter') {
        setFixMsg('Enabling the voltmeter — the device reboots to activate it…');
        const { rebooted } = await enableShellyVoltmeter(call, { reboot: true });
        if (rebooted) rescanDelayMs = 15000; // wait out the reboot before re-probing
      } else if (action === 'reregister_webhooks') {
        const vid = getActiveVehicleId();
        if (!vid) throw new Error('No active vehicle.');
        setFixMsg('Re-registering cloud webhooks…');
        const base = localStorage.getItem('sh_webhook_url') || DEFAULT_WORKER_URL;
        const key = localStorage.getItem('sh_webhook_url') ? (localStorage.getItem('sh_webhook_key') || '') : '';
        const prior = device.webhookCloudBase && device.webhookCloudBase !== base ? device.webhookCloudBase : undefined;
        await refreshCloudShellyWebhooks(call, base, vid, device.shellyDeviceId || '', prior, key, ensureWebhookSecret());
        if (device.webhookCloudBase !== base) updateDevice(device.id, { webhookCloudBase: base });
      }
      setFixMsg(action === 'enable_voltmeter' ? 'Applied — waiting for the device to reboot, then rescanning…' : 'Applied — rescanning…');
      await wait(rescanDelayMs);
      await runScan();
      setFixMsg(null);
    } catch (e: any) {
      setFixMsg(`Fix failed: ${e?.message || e}`);
    } finally {
      setFixing(null);
    }
  };

  const problems = (issues || []).filter((i) => i.severity !== 'ok');
  const busy = scanning || fixing !== null;

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
        <button className="btn-secondary" disabled={busy} onClick={runScan}
          style={{ padding: '6px 12px', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
          {scanning ? 'Scanning…' : '🩺 Scan for issues'}
        </button>
      </div>
      {fixMsg && (
        <div style={{ fontSize: '0.78rem', color: fixMsg.startsWith('Fix failed') ? '#ef4444' : 'var(--accent-cyan)' }}>{fixMsg}</div>
      )}
      {issues && issues.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {issues.map((iss, idx) => (
            <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '0.8rem' }}>
              <span aria-hidden>{SEVERITY_UI[iss.severity].icon}</span>
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 700, color: SEVERITY_UI[iss.severity].color }}>{iss.title}</span>
                <span style={{ color: 'var(--text-secondary)' }}> — {iss.detail}</span>
              </div>
              {iss.fix && iss.severity !== 'ok' && (
                <button className="btn-primary" disabled={busy} onClick={() => runFix(iss.fix!.action)}
                  style={{ padding: '4px 10px', fontSize: '0.72rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {fixing === iss.fix.action ? 'Fixing…' : `🔧 ${iss.fix.label}`}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
