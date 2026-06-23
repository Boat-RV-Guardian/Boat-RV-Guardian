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

/**
 * Register cloud-alert webhooks on a Shelly. `call` runs one RPC (works over HTTP or BLE), so this
 * is transport-agnostic. Discovers the device's supported events and points the alert-relevant ones
 * at `${baseUrl}/api/shelly?vid=…&event=…`. Returns the events it successfully registered.
 */
export async function registerShellyWebhooks(
  call: (method: string, params: any) => Promise<any>,
  baseUrl: string,
  vid: string,
  deviceId = '',
): Promise<string[]> {
  let supported: string[] = [];
  try {
    const sup = await call('Webhook.ListSupported', {});
    supported = sup?.hook_types || (sup?.types ? Object.keys(sup.types) : []) || [];
  } catch { /* device may not support discovery */ }

  const alertish = supported.filter((e) => /flood|alarm|leak|smoke|over|under|sensor|temperature|motion|opened|closed|btn/i.test(e));
  const events = (alertish.length ? alertish : supported).slice(0, 8); // cap to avoid spamming
  const root = baseUrl.replace(/\/$/, '');
  const dev = deviceId ? `&device=${encodeURIComponent(deviceId)}` : '';

  const created: string[] = [];
  for (const event of events) {
    const url = `${root}/api/shelly?vid=${encodeURIComponent(vid)}${dev}&event=${encodeURIComponent(event)}`;
    try {
      await call('Webhook.Create', { cid: 0, enable: true, event, urls: [url] });
      created.push(event);
    } catch { /* skip events that need a different cid/format */ }
  }
  return created;
}

/**
 * Self-heal the device's LOCAL webhook(s) to point at the current app IP, leaving cloud hooks
 * untouched. Call while the device is awake (e.g. inside a shelly-local-event strike). Local hooks
 * are identified by a private-LAN host + the /api/shelly path. Hardware-untested; best-effort.
 */
export async function refreshLocalShellyWebhooks(
  call: (method: string, params: any) => Promise<any>,
  localBase: string,
  vid: string,
  deviceId = '',
): Promise<void> {
  const isPrivate = (u: string) => /\/api\/shelly/.test(u) && /\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u);
  const root = localBase.replace(/\/$/, '');
  let list: any;
  try { list = await call('Webhook.List', {}); } catch { return; }
  const hooks: any[] = list?.hooks || [];
  const found = hooks.filter(h => (h.urls || []).some(isPrivate));
  if (found.length === 0) {
    // No local hook yet (first time on this LAN) — create them at the current app IP.
    await registerShellyWebhooks(call, root, vid, deviceId);
    return;
  }
  for (const h of found) {
    const newUrls = (h.urls || []).map((u: string) =>
      isPrivate(u) ? u.replace(/^https?:\/\/[^/]+/, root) : u);
    try {
      await call('Webhook.Update', { id: h.id, enable: h.enable !== false, event: h.event, name: h.name, urls: newUrls });
    } catch { /* skip hooks that reject the update shape */ }
  }
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
