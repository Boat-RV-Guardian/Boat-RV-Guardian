import { describe, it, expect, vi } from 'vitest';
import { registerShellyWebhooks, refreshLocalShellyWebhooks, refreshCloudShellyWebhooks } from './shellyRpc';

// registerShellyWebhooks/refreshLocalShellyWebhooks take a transport-agnostic `call(method,params)`.
// We stand in a fake Shelly that answers the discovery RPCs, and capture the Webhook.Create/Update
// payloads so we can assert the URL value-params and the component id (cid) wiring — the exact bits
// flagged unverified in CLAUDE.md.
function fakeShelly(opts: { supported: string[]; status: Record<string, unknown>; existingHooks?: any[] }) {
  const created: any[] = [];
  const updated: any[] = [];
  const deleted: any[] = [];
  const call = vi.fn(async (method: string, params: any) => {
    switch (method) {
      case 'Webhook.ListSupported': return { hook_types: opts.supported };
      case 'Shelly.GetStatus': return opts.status;
      case 'Webhook.List': return { hooks: opts.existingHooks || [] };
      case 'Webhook.Create': created.push(params); return { id: created.length };
      case 'Webhook.Update': updated.push(params); return {};
      case 'Webhook.Delete': deleted.push(params); return {};
      default: return {};
    }
  });
  return { call, created, updated, deleted };
}

describe('registerShellyWebhooks', () => {
  it('embeds voltmeter value params and the right cid (voltmeter:100 → 100)', async () => {
    const sh = fakeShelly({
      supported: ['voltmeter.measurement', 'voltmeter.change'],
      status: { 'voltmeter:100': {}, 'sys': {} },
    });

    const events = await registerShellyWebhooks(sh.call, 'https://w.example.com/', 'veh1', 'dev1');

    expect(events).toEqual(['voltmeter.measurement', 'voltmeter.change']);
    const hook = sh.created[0];
    expect(hook.cid).toBe(100); // component id resolved from the voltmeter:100 status key
    expect(hook.urls[0]).toContain('vid=veh1');
    expect(hook.urls[0]).toContain('device=dev1');
    expect(hook.urls[0]).toContain('&v=${ev.xvoltage}&vraw=${ev.voltage}');
  });

  it('defaults cid to 0 for a flood sensor and embeds no value params', async () => {
    const sh = fakeShelly({
      supported: ['flood.alarm', 'flood.alarm_off'],
      status: { 'flood:0': {} },
    });

    await registerShellyWebhooks(sh.call, 'https://w.example.com', 'veh1');

    const alarm = sh.created.find((h) => h.event === 'flood.alarm');
    expect(alarm.cid).toBe(0);
    expect(alarm.urls[0]).not.toContain('&v=');
    expect(alarm.urls[0]).not.toContain('device='); // deviceId omitted
  });

  it('uses the correct per-family value param for temperature', async () => {
    const sh = fakeShelly({ supported: ['temperature.change'], status: { 'temperature:0': {} } });
    await registerShellyWebhooks(sh.call, 'https://w.example.com', 'veh1');
    expect(sh.created[0].urls[0]).toContain('&tC=${ev.tC}');
  });

  it('prefers alert-ish events and caps the set at 10', async () => {
    const noise = Array.from({ length: 15 }, (_, i) => `input:${i}.toggle`); // non-alert events
    const sh = fakeShelly({ supported: ['flood.alarm', ...noise], status: { 'flood:0': {} } });
    const events = await registerShellyWebhooks(sh.call, 'https://w.example.com', 'veh1');
    expect(events).toEqual(['flood.alarm']); // only the alert-ish one is kept
  });

  it('appends the self-host key (&key=) and the per-vehicle secret (&k=) when provided (SEC-4)', async () => {
    const sh = fakeShelly({ supported: ['flood.alarm'], status: { 'flood:0': {} } });
    await registerShellyWebhooks(sh.call, 'https://w.example.com', 'veh1', 'dev1', 'INSTKEY', 'VEHSECRET');
    const url = sh.created[0].urls[0];
    expect(url).toContain('&key=INSTKEY');
    expect(url).toContain('&k=VEHSECRET');
  });

  it('omits both auth params when neither is provided', async () => {
    const sh = fakeShelly({ supported: ['flood.alarm'], status: { 'flood:0': {} } });
    await registerShellyWebhooks(sh.call, 'https://w.example.com', 'veh1');
    const url = sh.created[0].urls[0];
    expect(url).not.toContain('&key=');
    expect(url).not.toContain('&k=');
  });
});

describe('refreshLocalShellyWebhooks merge semantics', () => {
  it('keeps other listeners but replaces our own stale (current+prior host) url', async () => {
    const sh = fakeShelly({
      supported: ['flood.alarm'],
      status: { 'flood:0': {} },
      existingHooks: [{
        id: 7, event: 'flood.alarm', name: 'brvg-local',
        urls: [
          'http://192.168.1.50/api/shelly?vid=veh1&event=flood.alarm',  // our PRIOR host → drop
          'http://10.0.0.9/api/shelly?vid=veh1&event=flood.alarm',      // another listener → keep
        ],
      }],
    });

    await refreshLocalShellyWebhooks(
      sh.call,
      'http://192.168.1.99', // our current host
      'veh1',
      '',
      'http://192.168.1.50', // our prior host
    );

    expect(sh.updated).toHaveLength(1);
    const urls: string[] = sh.updated[0].urls;
    expect(urls.some((u) => u.includes('10.0.0.9'))).toBe(true);   // other listener preserved
    expect(urls.some((u) => u.includes('192.168.1.50'))).toBe(false); // our prior url dropped
    expect(urls.some((u) => u.includes('192.168.1.99'))).toBe(true);  // our current url added
    expect(urls.length).toBeLessThanOrEqual(5); // Shelly's 5-URL cap respected
  });
});

describe('refreshCloudShellyWebhooks (voltmeter self-heal + SEC-4 secret)', () => {
  it('creates the voltmeter telemetry hook (with v/vraw) once the peripheral exists', async () => {
    // A Uni whose voltmeter is now live → ListSupported includes voltmeter.* and the status has voltmeter:100.
    const sh = fakeShelly({
      supported: ['input.toggle_on', 'voltmeter.change', 'voltmeter.measurement'],
      status: { 'voltmeter:100': { id: 100 } },
      existingHooks: [], // provisioned before the voltmeter existed → no voltmeter hook yet
    });
    await refreshCloudShellyWebhooks(sh.call, 'https://api.boatrvguardian.com', 'v1', 'uni1', undefined, '', 'SEKRET');

    const meas = sh.created.find((c) => c.event === 'voltmeter.measurement');
    expect(meas).toBeTruthy();
    expect(meas.cid).toBe(100); // voltmeter:100 → cid 100, not the default 0
    expect(meas.urls[0]).toContain('event=voltmeter.measurement');
    expect(meas.urls[0]).toContain('v=${ev.xvoltage}');
    expect(meas.urls[0]).toContain('vraw=${ev.voltage}');
    expect(meas.urls[0]).toContain('&k=SEKRET'); // per-vehicle SEC-4 secret
    // input.* is not alert/telemetry-ish → not registered when voltmeter events are present.
    expect(sh.created.some((c) => c.event === 'input.toggle_on')).toBe(false);
  });

  it('merges the worker url into an existing hook without dropping a local listener', async () => {
    const sh = fakeShelly({
      supported: ['voltmeter.measurement'],
      status: { 'voltmeter:100': { id: 100 } },
      existingHooks: [{
        id: 9, event: 'voltmeter.measurement', name: 'brvg-local',
        urls: ['http://192.168.1.50:3030/api/shelly?vid=v1&event=voltmeter.measurement'], // a local listener
      }],
    });
    await refreshCloudShellyWebhooks(sh.call, 'https://api.boatrvguardian.com', 'v1', 'uni1');

    expect(sh.updated).toHaveLength(1);
    const urls: string[] = sh.updated[0].urls;
    expect(urls.some((u) => u.includes('192.168.1.50:3030'))).toBe(true);         // local listener kept
    expect(urls.some((u) => u.includes('api.boatrvguardian.com'))).toBe(true);    // worker url added
  });

  it('registers a shore-power pm1 voltage hook carrying the voltage value', async () => {
    const sh = fakeShelly({
      supported: ['pm1.voltage_change', 'pm1.current_change', 'pm1.apower_change'],
      status: { 'pm1:0': { id: 0, voltage: 118 } },
      existingHooks: [],
    });
    await refreshCloudShellyWebhooks(sh.call, 'https://api.boatrvguardian.com', 'v1', 'pm1', undefined, '', 'S');
    const volt = sh.created.find((c) => c.event === 'pm1.voltage_change');
    expect(volt).toBeTruthy();
    expect(volt.urls[0]).toContain('v=${ev.voltage}'); // value embedded so the worker caches it
  });

  it('collapses duplicate hooks for the same event (updates the first, deletes the rest)', async () => {
    const sh = fakeShelly({
      supported: ['pm1.voltage_change'],
      status: { 'pm1:0': { id: 0 } },
      existingHooks: [
        { id: 1, event: 'pm1.voltage_change', urls: ['https://api.boatrvguardian.com/api/shelly?vid=v1&event=pm1.voltage_change'] },
        { id: 4, event: 'pm1.voltage_change', urls: ['https://api.boatrvguardian.com/api/shelly?vid=v1&event=pm1.voltage_change'] }, // duplicate
      ],
    });
    await refreshCloudShellyWebhooks(sh.call, 'https://api.boatrvguardian.com', 'v1', 'pm1');
    expect(sh.updated).toHaveLength(1);
    expect(sh.updated[0].id).toBe(1);          // first kept + updated
    expect(sh.deleted.map((d) => d.id)).toEqual([4]); // duplicate removed
  });
});
