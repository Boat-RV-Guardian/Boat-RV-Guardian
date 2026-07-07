// Shelly Gen2 local RPC over HTTP, auth-aware.
//
// Shelly Gen2 does authentication INSIDE the JSON-RPC body (a digest challenge), so we can do it
// in plain JS — no native sockets, works on Tauri (tauri-http) and Capacitor (CapacitorHttp).
// shellyRpc() tries unauthenticated first; if the device requires a password it performs the
// digest handshake with the vehicle's sh_local_password and retries. So polling works whether or
// not a device is secured.
//
// NOTE: the digest computation follows the Shelly Gen2 spec but is hardware-untested — verify the
// secured-device path against a real Shelly. The unauthenticated path is the common case today.
import { nativeFetch } from './nativeFetch';

const isTauriEnv = () =>
  typeof window !== 'undefined' && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).isTauri);

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function rawPost(ip: string, bodyObj: any): Promise<{ status: number; data: any }> {
  const url = `http://${ip}/rpc`;
  const body = JSON.stringify(bodyObj);
  if (isTauriEnv()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    const res = await tauriFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    let data: any = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, data };
  }
  const res = await nativeFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  let data: any = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: (res as any).status ?? 200, data };
}

const isAuthChallenge = (r: { status: number; data: any }) =>
  r.status === 401 || (r.data && r.data.error && r.data.error.code === 401);

/** Call a Shelly Gen2 RPC method, authenticating with `password` only if the device demands it. */
export async function shellyRpc(ip: string, method: string, params: any = {}, password?: string): Promise<any> {
  const first = await rawPost(ip, { id: 1, method, params });
  if (!isAuthChallenge(first)) {
    if (first.data && first.data.error) throw new Error(first.data.error.message || 'Shelly RPC error');
    return first.data?.result ?? first.data;
  }

  if (!password) throw new Error('This Shelly requires a password (set it in the vehicle settings).');

  // Parse the digest challenge (Shelly returns it as a JSON string in error.message).
  let challenge: any = {};
  try { challenge = JSON.parse(first.data.error.message); } catch { challenge = first.data?.error || {}; }
  const realm: string = challenge.realm || '';
  const nonce = challenge.nonce;
  const ha1 = await sha256Hex(`admin:${realm}:${password}`);
  const ha2 = await sha256Hex('dummy_method:dummy_uri');
  const cnonce = Math.floor(Math.random() * 1e8);
  const nc = 1;
  const response = await sha256Hex(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`);
  const auth = { realm, username: 'admin', nonce, cnonce, response, algorithm: 'SHA-256' };

  const second = await rawPost(ip, { id: 2, method, params, auth });
  if (second.data && second.data.error) throw new Error(second.data.error.message || 'Shelly RPC auth error');
  return second.data?.result ?? second.data;
}

// Events we push to the worker: alerts AND periodic telemetry (voltmeter/temperature/humidity
// .measurement + .change), so the worker can cache live readings for remote display — not just alarms.
const WEBHOOK_EVENT_RE = /flood|alarm|leak|smoke|over|under|sensor|temperature|humidity|motion|opened|closed|btn|voltmeter|voltage/i;

// Extra URL params that embed the event's value(s) so the worker caches real readings. SINGLE-QUOTED
// on purpose: the ${...} are literal Shelly webhook tokens (evaluated on the device at fire time),
// NOT JS template interpolation. ev.xvoltage is the on-device calibrated voltage (null if uncalibrated).
//
// EVERY event also carries &ip=${status.wifi.sta_ip} — the device's CURRENT LAN IP, evaluated per fire
// (webhook tokens can read the whole Shelly.GetStatus object; sta_ip verified on hardware). The worker
// stores it in sensorState, so the cloud tracks each device's LAN IP through DHCP churn and the app
// self-heals `device.localIp` from it (ShellyWidget). If wifi status were absent the token yields the
// literal string "null", which the worker's extractSensorStateExtras already drops.
const WEBHOOK_IP_PARAM = '&ip=${status.wifi.sta_ip}';
function webhookValueParams(event: string): string {
  if (/^voltmeter\./i.test(event)) return '&v=${ev.xvoltage}&vraw=${ev.voltage}' + WEBHOOK_IP_PARAM;
  // Shore-power PM (e.g. PM Mini G3): pm1.voltage_change carries the AC line voltage. Send it as v so
  // the worker caches it and the High Power widget shows it off-LAN. (No xvoltage on pm1 — raw only.)
  if (/^pm1\.voltage/i.test(event)) return '&v=${ev.voltage}' + WEBHOOK_IP_PARAM;
  if (/^temperature\./i.test(event)) return '&tC=${ev.tC}' + WEBHOOK_IP_PARAM;
  if (/^humidity\./i.test(event)) return '&rh=${ev.rh}' + WEBHOOK_IP_PARAM;
  if (/^devicepower\./i.test(event)) return '&batt=${ev.percent}' + WEBHOOK_IP_PARAM;
  return WEBHOOK_IP_PARAM;
}

// Webhook.Create needs the component-instance id the event belongs to (e.g. voltmeter:100 → cid 100;
// flood:0 → cid 0). Build family→id from Shelly.GetStatus keys; default to 0 when unknown.
function buildCidMap(status: any): Record<string, number> {
  const map: Record<string, number> = {};
  for (const k of Object.keys(status || {})) {
    const m = /^([a-z_]+):(\d+)$/i.exec(k);
    if (m && map[m[1]] === undefined) map[m[1]] = Number(m[2]);
  }
  return map;
}
const cidFor = (event: string, cidMap: Record<string, number>): number => cidMap[event.split('.')[0]] ?? 0;

/**
 * Register cloud-alert + telemetry webhooks on a Shelly. `call` runs one RPC (works over HTTP or
 * BLE), so this is transport-agnostic. Discovers supported events and points the relevant ones at
 * `${baseUrl}/api/shelly?vid=…&event=…` with the event's value(s) embedded. Returns the events created.
 */
export async function registerShellyWebhooks(
  call: (method: string, params: any) => Promise<any>,
  baseUrl: string,
  vid: string,
  deviceId = '',
  key = '',
  secret = '',
): Promise<string[]> {
  let supported: string[] = [];
  try {
    const sup = await call('Webhook.ListSupported', {});
    supported = sup?.hook_types || (sup?.types ? Object.keys(sup.types) : []) || [];
  } catch { /* device may not support discovery */ }

  const alertish = supported.filter((e) => WEBHOOK_EVENT_RE.test(e));
  const events = (alertish.length ? alertish : supported).slice(0, 10);
  const root = baseUrl.replace(/\/$/, '');
  const dev = deviceId ? `&device=${encodeURIComponent(deviceId)}` : '';
  // Instance API key for a self-hosted cloud server (?key=), and the per-vehicle webhook bearer secret
  // (?k=, SEC-4) the hosted worker verifies. Both optional; a device may carry either/both.
  const auth = key ? `&key=${encodeURIComponent(key)}` : '';
  const perVehicle = secret ? `&k=${encodeURIComponent(secret)}` : '';

  let cidMap: Record<string, number> = {};
  try { cidMap = buildCidMap(await call('Shelly.GetStatus', {})); } catch { /* default cid 0 */ }

  const created: string[] = [];
  for (const event of events) {
    const url = `${root}/api/shelly?vid=${encodeURIComponent(vid)}${dev}&event=${encodeURIComponent(event)}${webhookValueParams(event)}${auth}${perVehicle}`;
    try {
      await call('Webhook.Create', { cid: cidFor(event, cidMap), enable: true, event, urls: [url] });
      created.push(event);
    } catch { /* skip events that need a different cid/format */ }
  }
  return created;
}

/**
 * Ensure this app instance is a local-webhook target on the device, for the full alert-event set.
 *
 * MERGES rather than replaces: each Shelly hook holds up to 5 URLs, so multiple app instances
 * (e.g. a desktop + a phone on the same boat) can all receive events. We add/refresh OUR url and
 * keep other listeners' urls; we drop only our own stale entry (current host, or `priorBase`'s host
 * from a previous IP) so DHCP churn doesn't pile up dead URLs. Call while the device is awake.
 */
async function mergeShellyWebhooks(
  call: (method: string, params: any) => Promise<any>,
  base: string,
  vid: string,
  deviceId: string,
  priorBase: string | undefined,
  key: string,
  secret: string,
): Promise<void> {
  const root = base.replace(/\/$/, '');
  const hostOf = (u: string) => { try { return new URL(u).host; } catch { return ''; } };
  const myHost = hostOf(root);
  const priorHost = priorBase ? hostOf(priorBase.replace(/\/$/, '')) : '';
  // Instance API key for a self-hosted server (?key=) + the per-vehicle SEC-4 bearer secret (?k=).
  const auth = key ? `&key=${encodeURIComponent(key)}` : '';
  const perVehicle = secret ? `&k=${encodeURIComponent(secret)}` : '';

  // Desired alert/telemetry events (so e.g. a flood sensor gets flood.alarm AND flood.alarm_off AND
  // flood.cable_unplugged — without alarm_off the UI never clears back to dry; a Plus Uni gets its
  // voltmeter.measurement/.change once the peripheral is live). CRITICAL for the voltmeter case:
  // this runs on every successful local poll, so a device provisioned before its voltmeter existed
  // self-heals here once the peripheral is enabled (Webhook.ListSupported then includes it).
  let supported: string[] = [];
  try {
    const sup = await call('Webhook.ListSupported', {});
    supported = sup?.hook_types || (sup?.types ? Object.keys(sup.types) : []) || [];
  } catch { /* device may not support discovery */ }
  const alertish = supported.filter((e) => WEBHOOK_EVENT_RE.test(e));
  const events = (alertish.length ? alertish : supported).slice(0, 10);
  if (events.length === 0) return;

  let cidMap: Record<string, number> = {};
  try { cidMap = buildCidMap(await call('Shelly.GetStatus', {})); } catch { /* default cid 0 */ }

  let hooks: any[] = [];
  try { const list = await call('Webhook.List', {}); hooks = list?.hooks || []; } catch { /* none */ }

  for (const event of events) {
    const myUrl = `${root}/api/shelly?vid=${encodeURIComponent(vid)}${deviceId ? `&device=${encodeURIComponent(deviceId)}` : ''}&event=${encodeURIComponent(event)}${webhookValueParams(event)}${auth}${perVehicle}`;
    // Match our own prior entry for this event by HOST (query params like &k= rotate), so we update
    // in place instead of piling up duplicates. If earlier runs created duplicate hooks for the same
    // event (seen on a PM Mini), collapse them: update the first, delete the rest.
    const matches = hooks.filter((h) => h.event === event);
    const existing = matches[0];
    try {
      if (existing) {
        // Keep other listeners; drop our own (current + prior) host; add our current url. Cap at 5.
        const others = (existing.urls || []).filter((u: string) => { const h = hostOf(u); return h && h !== myHost && h !== priorHost; });
        const merged = Array.from(new Set([...others, myUrl])).slice(0, 5);
        await call('Webhook.Update', { id: existing.id, enable: true, event, name: existing.name || 'brvg-local', urls: merged });
        for (const dup of matches.slice(1)) { try { await call('Webhook.Delete', { id: dup.id }); } catch { /* leave it */ } }
      } else {
        await call('Webhook.Create', { cid: cidFor(event, cidMap), enable: true, event, name: 'brvg-local', urls: [myUrl] });
      }
    } catch { /* skip events that reject the cid/shape */ }
  }
}

// Ensure this app instance is a LOCAL-webhook target (the device pushes events straight to us over the
// LAN with no internet). MERGES rather than replaces (each hook holds up to 5 URLs), dropping only our
// own stale host so DHCP churn doesn't pile up dead URLs. Call while the device is awake.
export const refreshLocalShellyWebhooks = (
  call: (method: string, params: any) => Promise<any>,
  localBase: string,
  vid: string,
  deviceId = '',
  priorBase?: string,
): Promise<void> => mergeShellyWebhooks(call, localBase, vid, deviceId, priorBase, '', '');

// Ensure the hosted/self-host WORKER is a webhook target (for off-LAN alerts + telemetry). Same merge
// semantics; adds the self-host ?key= and per-vehicle SEC-4 ?k= secret. Re-running this on each poll is
// how a device provisioned before its voltmeter peripheral existed self-heals its telemetry hooks.
export const refreshCloudShellyWebhooks = (
  call: (method: string, params: any) => Promise<any>,
  cloudBase: string,
  vid: string,
  deviceId = '',
  priorBase?: string,
  key = '',
  secret = '',
): Promise<void> => mergeShellyWebhooks(call, cloudBase, vid, deviceId, priorBase, key, secret);

/**
 * Enable the Shelly Plus Uni's 0-30 V DC voltmeter. The Uni's onboard ADC has NO Voltmeter
 * component out of the box — it must be linked as an add-on PERIPHERAL (SensorAddon.AddPeripheral
 * { type:'voltmeter' }), which creates a `voltmeter:100` component (peripheral-linked ids start at
 * 100). Verified on hardware (fw 1.7.5, SNSN-0043X): adding the peripheral sets sys.restart_required
 * but does NOT auto-reboot, and the component does NOT appear in Shelly.GetStatus until a reboot —
 * so we must reboot to activate it. This firmware exposes no Voltmeter.* RPC (range/threshold aren't
 * settable via RPC; the device reports actual volts regardless). `call` runs one RPC (HTTP or BLE).
 *
 * `opts.reboot` (default true) issues Shelly.Reboot after linking so the component goes live. Pass
 * false in the Wi-Fi-AP provisioning path, where the device reboots on its own when it joins Wi-Fi
 * (an early reboot there would abort the rest of provisioning). Returns { id, rebooted }; throws the
 * device's error if AddPeripheral fails and no voltmeter is present, so callers can surface why.
 */
export async function enableShellyVoltmeter(
  call: (method: string, params: any) => Promise<any>,
  opts: { reboot?: boolean } = {},
): Promise<{ id: number | null; rebooted: boolean }> {
  const reboot = opts.reboot !== false;
  const idFromKeys = (obj: any): number | null => {
    for (const k of Object.keys(obj || {})) {
      const m = /voltmeter:(\d+)/.exec(k);
      if (m) return Number(m[1]);
    }
    return null;
  };

  // 1. Already live? (component present in Shelly.GetStatus → no reboot needed)
  try {
    const live = idFromKeys(await call('Shelly.GetStatus', {}));
    if (live != null) return { id: live, rebooted: false };
  } catch { /* fall through */ }

  // 2. Peripheral already linked (just needs a reboot to activate)?
  let id: number | null = null;
  try {
    const ps = await call('SensorAddon.GetPeripherals', {});
    id = idFromKeys(ps?.voltmeter) ?? idFromKeys(ps);
  } catch { /* ignore */ }

  // 3. Not linked yet → add it. (throws with the device's message on failure)
  if (id == null) {
    const res = await call('SensorAddon.AddPeripheral', { type: 'voltmeter' });
    id = idFromKeys(res) ?? idFromKeys(res?.voltmeter);
  }

  // 4. Activate it — the component only shows up in status after a reboot.
  if (id != null && reboot) {
    try { await call('Shelly.Reboot', {}); } catch { /* connection drops as it reboots — expected */ }
    return { id, rebooted: true };
  }
  return { id, rebooted: false };
}

/**
 * Onboarding/diagnostic firmware check. `call` runs one RPC (works over HTTP or BLE). Returns the
 * device's current version and the available stable update version (undefined if up to date).
 */
export async function shellyCheckFirmware(
  call: (method: string, params: any) => Promise<any>,
): Promise<{ version?: string; updateVersion?: string }> {
  let version: string | undefined;
  try {
    const info = await call('Shelly.GetDeviceInfo', {});
    version = info?.ver;
  } catch { /* keep undefined */ }
  let updateVersion: string | undefined;
  try {
    const upd = await call('Shelly.CheckForUpdate', {});
    const stable = upd?.stable?.version;
    if (stable && stable !== version) updateVersion = stable;
  } catch { /* device offline / no update server reachable */ }
  return { version, updateVersion };
}

/** Apply the available stable firmware update. The device downloads + reboots (~1–2 min). */
export async function shellyApplyUpdate(
  call: (method: string, params: any) => Promise<any>,
): Promise<void> {
  await call('Shelly.Update', { stage: 'stable' });
}

/** Secure a device by setting its admin password (HA1). Call on a reachable, unsecured device. */
export async function shellySetPassword(ip: string, deviceId: string, password: string): Promise<void> {
  const ha1 = await sha256Hex(`admin:${deviceId}:${password}`);
  await rawPost(ip, { id: 1, method: 'Shelly.SetAuth', params: { user: 'admin', realm: deviceId, ha1 } });
}

/** Remove the device's admin password (requires the current password for the digest). */
export async function shellyClearPassword(ip: string, password: string): Promise<void> {
  await shellyRpc(ip, 'Shelly.SetAuth', { user: 'admin', realm: '', ha1: null }, password);
}

/**
 * Change a device's admin password to `newPassword`, authenticating with `oldPassword` if the device
 * is already secured. Uses shellyRpc (unauth → digest fallback), so this works whether the device is
 * currently unsecured (oldPassword ignored) or secured (digest with oldPassword). The new HA1 is
 * computed over the device id (the Shelly realm). HARDWARE-UNTESTED — a wrong/failed SetAuth can lock
 * the device out (factory reset to recover), so callers must confirm with the user first.
 */
export async function shellyChangePassword(ip: string, deviceId: string, newPassword: string, oldPassword?: string): Promise<void> {
  const ha1 = await sha256Hex(`admin:${deviceId}:${newPassword}`);
  await shellyRpc(ip, 'Shelly.SetAuth', { user: 'admin', realm: deviceId, ha1 }, oldPassword);
}
