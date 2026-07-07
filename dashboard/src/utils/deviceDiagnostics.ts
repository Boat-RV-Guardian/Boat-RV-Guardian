// Per-device "Scan for issues" diagnostics (Settings → Devices → Configuration → ⚙️ → Scan).
//
// Catches the misconfigurations we've actually been bitten by on hardware: a Low Power Sensor whose
// voltmeter peripheral was never enabled (no telemetry), a device with no local password
// (auth_en:false — the BLE/AP gap), cloud webhooks still pointing at the old worker / missing the
// per-vehicle &k= secret (they 401 on the hosted worker), a flood sensor without flood.alarm_off
// (the UI never clears back to dry), and a stale stored LAN IP after DHCP churn.
//
// Split for testability: classify*() are PURE — they turn probe results into findings; scanDevice()
// is the orchestrator that gathers the probe over the device RPC (injected, so tests never touch a
// network). Severity: 'error' = broken now, 'warn' = degraded/insecure, 'info' = advisory, 'ok'.

import type { DeviceConfig } from './VehicleManager';

export type IssueSeverity = 'error' | 'warn' | 'info' | 'ok';

/** Auto-remediations the scan panel knows how to run (each maps to an existing, proven helper). */
export type FixAction = 'set_password' | 'enable_voltmeter' | 'reregister_webhooks';

export interface DeviceIssue {
  severity: IssueSeverity;
  title: string;
  /** One-line explanation + what to do about it. */
  detail: string;
  /** Present when the app can fix this itself — renders a Fix button next to the finding. */
  fix?: { action: FixAction; label: string };
}

export interface ShellyProbe {
  /** Shelly.GetDeviceInfo (has auth_en); null if the call failed. */
  info: any | null;
  /** Shelly.GetStatus; null if the call failed. */
  status: any | null;
  /** Webhook.List hooks array; null if the call failed. */
  hooks: any[] | null;
}

export interface ScanContext {
  /** The cloud worker base the device's webhooks should point at. */
  webhookBase: string;
  /** Per-vehicle SEC-4 webhook secret ('' if none yet). */
  webhookSecret: string;
  /** Signed in to the hosted cloud? (webhook checks only apply then) */
  signedIn: boolean;
}

const hostOf = (u: string): string => { try { return new URL(u).host; } catch { return ''; } };

/** PURE: findings for a Shelly device from its probe results. */
export function classifyShellyProbe(device: DeviceConfig, probe: ShellyProbe, ctx: ScanContext): DeviceIssue[] {
  const issues: DeviceIssue[] = [];

  // Local password (the manual-IP path always set it; AP/BLE only since #118).
  if (probe.info) {
    if (probe.info.auth_en === false) {
      issues.push({
        severity: 'warn',
        title: 'No local password set',
        detail: 'Anyone on this network can control the device.',
        fix: { action: 'set_password', label: 'Set vehicle password' },
      });
    } else if (probe.info.auth_en === true) {
      issues.push({ severity: 'ok', title: 'Local password set', detail: 'Device requires authentication on its local API.' });
    }
  }

  // Voltmeter peripheral — the root cause of the "battery sensor shows nothing" class of bugs.
  if (device.role === 'Low Power Sensor' && probe.status) {
    const hasVoltmeter = Object.keys(probe.status).some((k) => /^voltmeter:\d+$/.test(k));
    if (!hasVoltmeter) {
      issues.push({
        severity: 'error',
        title: 'Voltmeter not enabled',
        detail: 'The 0-30 V voltmeter peripheral is not active, so no voltage is measured.',
        fix: { action: 'enable_voltmeter', label: 'Enable voltmeter (reboots device)' },
      });
    } else {
      issues.push({ severity: 'ok', title: 'Voltmeter enabled', detail: 'Voltage measurement is active.' });
    }
  }

  // Stored LAN IP vs where the device actually is (DHCP churn). The &ip= tracker self-heals this
  // from the cloud, but surface it here for an immediate fix while we're talking to the device.
  const staIp = probe.status?.wifi?.sta_ip;
  if (staIp && device.localIp && staIp !== device.localIp) {
    issues.push({
      severity: 'warn',
      title: 'Stored IP is stale',
      detail: `The app has ${device.localIp} but the device is now at ${staIp}. It self-heals from cloud telemetry; scanning fixed it for this session.`,
    });
  }

  // Firmware advisory (uses the last check's stored result — no network here).
  if (device.fwUpdateVersion) {
    issues.push({ severity: 'info', title: 'Firmware update available', detail: `v${device.fwUpdateVersion} is available — use the Firmware section below.` });
  }

  // Cloud webhooks — only meaningful when signed in (cloud alerts are a signed-in feature).
  if (!ctx.signedIn) {
    issues.push({ severity: 'info', title: 'Cloud alert checks skipped', detail: 'Sign in to verify this device pushes alerts/telemetry to the cloud.' });
  } else if (probe.hooks) {
    const wantHost = hostOf(ctx.webhookBase);
    const cloudUrls: string[] = probe.hooks.flatMap((h: any) => h?.urls || []).filter((u: string) => hostOf(u) === wantHost);
    if (cloudUrls.length === 0) {
      issues.push({
        severity: 'error',
        title: 'Cloud alerts not registered',
        detail: `No webhook points at ${wantHost}, so floods/telemetry never reach the cloud.`,
        fix: { action: 'reregister_webhooks', label: 'Register cloud alerts' },
      });
    } else {
      if (ctx.webhookSecret && !cloudUrls.some((u) => u.includes('&k='))) {
        issues.push({
          severity: 'error',
          title: 'Webhooks missing the auth secret',
          detail: 'The hosted worker rejects webhooks without the per-vehicle &k= secret (SEC-4) — events are being dropped.',
          fix: { action: 'reregister_webhooks', label: 'Re-register webhooks' },
        });
      }
      if (!cloudUrls.some((u) => u.includes('&ip='))) {
        issues.push({
          severity: 'info',
          title: 'Webhooks predate the LAN-IP tracker',
          detail: 'Hooks lack &ip=, so the cloud can\'t follow this device through DHCP changes yet.',
          fix: { action: 'reregister_webhooks', label: 'Upgrade webhooks' },
        });
      }
      // A flood sensor without alarm_off never clears back to "dry" in the app.
      if (device.role === 'Flood Sensor') {
        const hasOff = probe.hooks.some((h: any) => /alarm_off/i.test(h?.event || '') && (h?.urls || []).some((u: string) => hostOf(u) === wantHost));
        if (!hasOff) {
          issues.push({
            severity: 'warn',
            title: 'No flood.alarm_off webhook',
            detail: 'Flood alerts would never clear back to dry in the cloud.',
            fix: { action: 'reregister_webhooks', label: 'Re-register webhooks' },
          });
        }
      }
      if (!issues.some((i) => i.severity === 'error' && /webhook|cloud/i.test(i.title))) {
        issues.push({ severity: 'ok', title: 'Cloud alerts registered', detail: `Webhooks point at ${wantHost}.` });
      }
    }
  }

  return issues;
}

/** PURE: config-level findings for a LinkTap valve (no device I/O — the widget owns live status). */
export function classifyLinkTapConfig(
  device: DeviceConfig,
  cfg: { cloudUser: string; cloudKey: string; gatewayId: string },
  ctx: Pick<ScanContext, 'signedIn'>,
): DeviceIssue[] {
  const issues: DeviceIssue[] = [];
  if (!cfg.cloudUser || !cfg.cloudKey) {
    issues.push({
      severity: 'error',
      title: 'LinkTap account not connected',
      detail: 'No username/API key — cloud control and device discovery won\'t work. Connect it in Devices → Advanced Options (username + password → Get API Key).',
    });
  } else {
    issues.push({ severity: 'ok', title: 'LinkTap account connected', detail: 'Username + API key are configured.' });
  }
  if (!device.linktapGatewayId || !device.linktapDeviceId) {
    issues.push({
      severity: 'error',
      title: 'Valve not fully mapped',
      detail: 'Missing gateway or TapLinker ID — events can\'t be routed to this vehicle. Re-add the valve.',
    });
  }
  if (!cfg.gatewayId) {
    issues.push({
      severity: 'warn',
      title: 'No local gateway configured',
      detail: 'Without a gateway ID/IP the app has no on-LAN fallback when the cloud is unreachable. Set it in Devices → Advanced Options.',
    });
  }
  if (!ctx.signedIn) {
    issues.push({
      severity: 'info',
      title: 'Signed out',
      detail: 'Remote (off-LAN) valve state and control relay through the cloud and require sign-in.',
    });
  }
  return issues;
}

export interface ScanDeps {
  /** One Shelly RPC against the device (digest-aware). */
  rpc: (host: string, method: string, params: any) => Promise<any>;
  ctx: ScanContext;
  /** LinkTap config snapshot (root localStorage keys). */
  linktap: { cloudUser: string; cloudKey: string; gatewayId: string; gatewayIp: string };
  /** LAN reachability probe for the LinkTap gateway (resolves true if reachable); optional. */
  linktapProbe?: () => Promise<boolean>;
}

/**
 * Run the full scan for one device. Never throws — an unreachable device becomes a finding.
 * For Shelly, probes info/status/hooks over the LAN. For LinkTap: config checks PLUS a live LAN
 * reachability probe of the gateway when a gateway IP is set (yes — it checks local connectivity).
 */
export async function scanDevice(device: DeviceConfig, host: string | undefined, deps: ScanDeps): Promise<DeviceIssue[]> {
  if (device.type === 'linktap_valve') {
    const issues = classifyLinkTapConfig(device, deps.linktap, deps.ctx);
    if (deps.linktap.gatewayIp && deps.linktapProbe) {
      const reachable = await deps.linktapProbe();
      issues.push(reachable
        ? { severity: 'ok', title: 'Local gateway reachable', detail: `Reached the LinkTap gateway at ${deps.linktap.gatewayIp} — the on-LAN fast path is available.` }
        : { severity: 'warn', title: 'Local gateway not reachable', detail: `Couldn't reach the gateway at ${deps.linktap.gatewayIp}. Cloud control still works; check you're on the boat's network for the faster local path.` });
    }
    return issues;
  }

  if (!host) {
    return [{
      severity: 'error',
      title: 'No local address known',
      detail: 'The app has no IP or mDNS name for this device. Re-provision it, or wait for cloud telemetry to report its address.',
    }];
  }

  const probe: ShellyProbe = { info: null, status: null, hooks: null };
  try { probe.info = await deps.rpc(host, 'Shelly.GetDeviceInfo', {}); } catch { /* unreachable */ }
  if (!probe.info) {
    const sleepy = device.batteryPowered === true || device.role === 'Flood Sensor';
    return [{
      severity: sleepy ? 'info' : 'error',
      title: sleepy ? 'Device is asleep' : 'Device unreachable',
      detail: sleepy
        ? `No response at ${host} — battery sensors deep-sleep between reports. Wake it (press its button) and scan again.`
        : `No response at ${host}. Check power and that you're on the same network.`,
    }];
  }
  try { probe.status = await deps.rpc(host, 'Shelly.GetStatus', {}); } catch { /* partial scan */ }
  try { const l = await deps.rpc(host, 'Webhook.List', {}); probe.hooks = l?.hooks || []; } catch { /* partial scan */ }

  return classifyShellyProbe(device, probe, deps.ctx);
}
