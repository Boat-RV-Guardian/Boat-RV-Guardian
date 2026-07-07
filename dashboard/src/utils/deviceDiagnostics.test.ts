import { describe, it, expect, vi } from 'vitest';
import { classifyShellyProbe, classifyLinkTapConfig, scanDevice, type ScanContext } from './deviceDiagnostics';
import type { DeviceConfig } from './VehicleManager';

const ctx: ScanContext = { webhookBase: 'https://api.boatrvguardian.com', webhookSecret: 'SEK', signedIn: true };
const battDev: DeviceConfig = { id: 'd1', type: 'shelly_sensor', role: 'Low Power Sensor', name: 'House', shellyDeviceId: 'uni1', localIp: '192.168.1.10' };
const floodDev: DeviceConfig = { id: 'd2', type: 'shelly_sensor', role: 'Flood Sensor', name: 'Bilge', shellyDeviceId: 'flood1', batteryPowered: true };

const goodHooks = [
  { event: 'flood.alarm', urls: ['https://api.boatrvguardian.com/api/shelly?vid=v&event=flood.alarm&ip=${status.wifi.sta_ip}&k=SEK'] },
  { event: 'flood.alarm_off', urls: ['https://api.boatrvguardian.com/api/shelly?vid=v&event=flood.alarm_off&ip=${status.wifi.sta_ip}&k=SEK'] },
];

const titles = (issues: { title: string }[]) => issues.map((i) => i.title);

describe('classifyShellyProbe', () => {
  it('flags a missing local password (auth_en:false — the BLE/AP gap) with a set_password fix', () => {
    const issues = classifyShellyProbe(floodDev, { info: { auth_en: false }, status: {}, hooks: goodHooks }, ctx);
    const iss = issues.find((i) => i.title === 'No local password set')!;
    expect(iss.severity).toBe('warn');
    expect(iss.fix?.action).toBe('set_password');
  });

  it('flags a Low Power Sensor with no voltmeter component as an error with an enable_voltmeter fix', () => {
    const issues = classifyShellyProbe(battDev, { info: { auth_en: true }, status: { sys: {}, 'input:0': {} }, hooks: [] }, ctx);
    const iss = issues.find((i) => i.title === 'Voltmeter not enabled')!;
    expect(iss.severity).toBe('error');
    expect(iss.fix?.action).toBe('enable_voltmeter');
  });

  it('passes a healthy battery sensor (voltmeter live, password set, hooks current)', () => {
    const issues = classifyShellyProbe(battDev, {
      info: { auth_en: true },
      status: { 'voltmeter:100': {}, wifi: { sta_ip: '192.168.1.10' } },
      hooks: [{ event: 'voltmeter.measurement', urls: ['https://api.boatrvguardian.com/api/shelly?vid=v&event=voltmeter.measurement&ip=${status.wifi.sta_ip}&k=SEK'] }],
    }, ctx);
    expect(issues.every((i) => i.severity === 'ok')).toBe(true);
  });

  it('errors when no webhook points at the current worker host', () => {
    const issues = classifyShellyProbe(floodDev, {
      info: { auth_en: true }, status: {},
      hooks: [{ event: 'flood.alarm', urls: ['https://old-worker.workers.dev/api/shelly?vid=v'] }],
    }, ctx);
    const iss = issues.find((i) => i.title === 'Cloud alerts not registered')!;
    expect(iss.severity).toBe('error');
    expect(iss.fix?.action).toBe('reregister_webhooks'); // every webhook finding shares the one fix
  });

  it('errors when hooks hit the right host but lack the &k= secret (hosted worker 401s them)', () => {
    const issues = classifyShellyProbe(floodDev, {
      info: { auth_en: true }, status: {},
      hooks: [
        { event: 'flood.alarm', urls: ['https://api.boatrvguardian.com/api/shelly?vid=v&event=flood.alarm&ip=${status.wifi.sta_ip}'] },
        { event: 'flood.alarm_off', urls: ['https://api.boatrvguardian.com/api/shelly?vid=v&event=flood.alarm_off&ip=${status.wifi.sta_ip}'] },
      ],
    }, ctx);
    expect(issues.find((i) => i.title === 'Webhooks missing the auth secret')!.severity).toBe('error');
  });

  it('advises when hooks predate the LAN-IP tracker (&ip= absent)', () => {
    const issues = classifyShellyProbe(floodDev, {
      info: { auth_en: true }, status: {},
      hooks: [
        { event: 'flood.alarm', urls: ['https://api.boatrvguardian.com/api/shelly?vid=v&event=flood.alarm&k=SEK'] },
        { event: 'flood.alarm_off', urls: ['https://api.boatrvguardian.com/api/shelly?vid=v&event=flood.alarm_off&k=SEK'] },
      ],
    }, ctx);
    expect(issues.find((i) => i.title === 'Webhooks predate the LAN-IP tracker')!.severity).toBe('info');
  });

  it('warns a flood sensor that lacks flood.alarm_off (alerts would never clear)', () => {
    const issues = classifyShellyProbe(floodDev, {
      info: { auth_en: true }, status: {},
      hooks: [{ event: 'flood.alarm', urls: ['https://api.boatrvguardian.com/api/shelly?vid=v&event=flood.alarm&ip=x&k=SEK'] }],
    }, ctx);
    expect(issues.find((i) => i.title === 'No flood.alarm_off webhook')!.severity).toBe('warn');
  });

  it('warns when the stored IP no longer matches where the device is', () => {
    const issues = classifyShellyProbe(battDev, {
      info: { auth_en: true }, status: { 'voltmeter:100': {}, wifi: { sta_ip: '192.168.1.77' } }, hooks: goodHooks,
    }, ctx);
    expect(issues.find((i) => i.title === 'Stored IP is stale')!.detail).toContain('192.168.1.77');
  });

  it('skips webhook checks (info) when signed out', () => {
    const issues = classifyShellyProbe(floodDev, { info: { auth_en: true }, status: {}, hooks: goodHooks }, { ...ctx, signedIn: false });
    expect(titles(issues)).toContain('Cloud alert checks skipped');
    expect(titles(issues)).not.toContain('Cloud alerts registered');
  });
});

describe('classifyLinkTapConfig', () => {
  const valve: DeviceConfig = { id: 'v1', type: 'linktap_valve', role: 'Fresh Water', name: 'Valve', linktapGatewayId: 'gw', linktapDeviceId: 'tap' };

  it('errors when the account is not connected', () => {
    const issues = classifyLinkTapConfig(valve, { cloudUser: '', cloudKey: '', gatewayId: 'gw' }, { signedIn: true });
    expect(issues.find((i) => i.title === 'LinkTap account not connected')!.severity).toBe('error');
  });

  it('errors when the valve is missing its gateway/TapLinker mapping', () => {
    const bare: DeviceConfig = { id: 'v2', type: 'linktap_valve', role: 'Fresh Water', name: 'Valve' };
    const issues = classifyLinkTapConfig(bare, { cloudUser: 'u', cloudKey: 'k', gatewayId: 'gw' }, { signedIn: true });
    expect(issues.find((i) => i.title === 'Valve not fully mapped')!.severity).toBe('error');
  });

  it('is clean for a fully configured, signed-in valve', () => {
    const issues = classifyLinkTapConfig(valve, { cloudUser: 'u', cloudKey: 'k', gatewayId: 'gw' }, { signedIn: true });
    expect(issues.every((i) => i.severity === 'ok')).toBe(true);
  });
});

describe('scanDevice', () => {
  const deps = (rpc: any) => ({ rpc, ctx, linktap: { cloudUser: 'u', cloudKey: 'k', gatewayId: 'gw', gatewayIp: '' } });

  it('reports a sleeping battery sensor as info, not an error', async () => {
    const rpc = vi.fn(async () => { throw new Error('timeout'); });
    const issues = await scanDevice(floodDev, 'flood1.local', deps(rpc));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('info');
    expect(issues[0].title).toBe('Device is asleep');
  });

  it('reports an unreachable mains sensor as an error', async () => {
    const rpc = vi.fn(async () => { throw new Error('timeout'); });
    const issues = await scanDevice(battDev, '192.168.1.10', deps(rpc));
    expect(issues[0]).toMatchObject({ severity: 'error', title: 'Device unreachable' });
  });

  it('reports a device with no known address', async () => {
    const noIp: DeviceConfig = { id: 'x', type: 'shelly_sensor', role: 'High Power Sensor', name: 'PM', shellyDeviceId: 'pm1' };
    const issues = await scanDevice(noIp, undefined, deps(vi.fn()));
    expect(issues[0]).toMatchObject({ severity: 'error', title: 'No local address known' });
  });

  it('gathers info/status/hooks and classifies a reachable device', async () => {
    const rpc = vi.fn(async (_h: string, method: string) => {
      if (method === 'Shelly.GetDeviceInfo') return { auth_en: true };
      if (method === 'Shelly.GetStatus') return { 'voltmeter:100': {}, wifi: { sta_ip: '192.168.1.10' } };
      if (method === 'Webhook.List') return { hooks: [{ event: 'voltmeter.measurement', urls: ['https://api.boatrvguardian.com/api/shelly?vid=v&ip=x&k=SEK'] }] };
      return {};
    });
    const issues = await scanDevice(battDev, '192.168.1.10', deps(rpc));
    expect(issues.every((i) => i.severity === 'ok')).toBe(true);
  });

  it('probes LinkTap gateway LAN reachability when a gateway IP is set', async () => {
    const valve: DeviceConfig = { id: 'v1', type: 'linktap_valve', role: 'Fresh Water', name: 'V', linktapGatewayId: 'g', linktapDeviceId: 't' };
    const base = { ctx, rpc: vi.fn(), linktap: { cloudUser: 'u', cloudKey: 'k', gatewayId: 'gw', gatewayIp: '192.168.1.5' } };
    const reachable = await scanDevice(valve, undefined, { ...base, linktapProbe: async () => true });
    expect(reachable.find((i) => i.title === 'Local gateway reachable')!.severity).toBe('ok');
    const down = await scanDevice(valve, undefined, { ...base, linktapProbe: async () => false });
    expect(down.find((i) => i.title === 'Local gateway not reachable')!.severity).toBe('warn');
  });

  it('routes a LinkTap valve to the config checks (no device I/O)', async () => {
    const rpc = vi.fn();
    const valve: DeviceConfig = { id: 'v1', type: 'linktap_valve', role: 'Fresh Water', name: 'V', linktapGatewayId: 'g', linktapDeviceId: 't' };
    const issues = await scanDevice(valve, undefined, deps(rpc));
    expect(rpc).not.toHaveBeenCalled();
    expect(issues.length).toBeGreaterThan(0);
  });
});
