// Shelly Gen2/3 provisioning over Bluetooth LE (native Android/iOS only).
//
// Shelly exposes the mongoose-OS RPC service over GATT: write the request length to a TX-control
// characteristic, write the JSON request to the data characteristic in chunks, read the response
// length from RX-control, then read the data characteristic until the full response is assembled.
//
// The plugin is imported dynamically so the web/Tauri-desktop bundle never loads it.
// HARDWARE-UNTESTED: verify the framing against a real Shelly and tell me what comes back.
import type { BleClient as BleClientType } from '@capacitor-community/bluetooth-le';

const SVC = '5f6d4f53-5f52-5043-5f53-56435f49445f';       // _mOS_RPC_SVC_
const CHAR_DATA = '5f6d4f53-5f52-5043-5f64-6174615f5f5f';  // _mOS_RPC_data_
const CHAR_TX = '5f6d4f53-5f52-5043-5f74-785f63746c5f';    // _mOS_RPC_tx_ctl_
const CHAR_RX = '5f6d4f53-5f52-5043-5f72-785f63746c5f';    // _mOS_RPC_rx_ctl_

export interface BleShelly { deviceId: string; name: string; }

let inited = false;
async function client(): Promise<typeof BleClientType> {
  const m = await import('@capacitor-community/bluetooth-le');
  if (!inited) { await m.BleClient.initialize({ androidNeverForLocation: true }); inited = true; }
  return m.BleClient;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const u32be = (n: number): DataView => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, n, false); return d; };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Scan for nearby Shelly devices. Shelly advertises by NAME (not the RPC service UUID), so we
 *  scan unfiltered and keep advertisements whose name looks like a Shelly. */
export async function scanShellyDevices(durationMs = 7000): Promise<BleShelly[]> {
  const BleClient = await client();
  const found = new Map<string, BleShelly>();
  console.log('[shellyBle] starting LE scan');
  await BleClient.requestLEScan({ allowDuplicates: false }, (r: any) => {
    const name = r?.device?.name || r?.localName || '';
    if (name) console.log('[shellyBle] saw device:', name, r?.device?.deviceId);
    if (name && /shelly/i.test(name) && r?.device?.deviceId) {
      found.set(r.device.deviceId, { deviceId: r.device.deviceId, name });
    }
  });
  await wait(durationMs);
  try { await BleClient.stopLEScan(); } catch { /* ignore */ }
  console.log('[shellyBle] scan done, shellys found:', found.size);
  return [...found.values()];
}

// ---------------------------------------------------------------------------
// Offline mode: BLE advertisement (BTHome) scanning. Battery Shelly sensors broadcast their state
// (flood/battery/temp) over BLE when awake, with no internet/cloud/broker. A single shared scan
// feeds all subscribers. HARDWARE-UNTESTED decode — every advertisement is logged raw so we can map
// the real device's BTHome layout and iterate.
export interface AdvReading { mac: string; battery?: number; flood?: boolean; temperature?: number; encrypted?: boolean; present?: boolean; raw: string; }

const normMac = (s: string) => (s || '').toLowerCase().replace(/[^a-f0-9]/g, '');

// BTHome v2 object id → value byte length (after the id byte). Covers the objects a battery Shelly
// sensor can emit so we can walk PAST ones we don't surface instead of bailing on the first unknown.
// Measurements + the full binary-sensor block (each binary value is 1 byte, 0/1).
const BTHOME_LEN: Record<number, number> = {
  0x00: 1, 0x01: 1, 0x02: 2, 0x03: 2, 0x04: 3, 0x05: 3, 0x06: 2, 0x07: 4, 0x08: 2, 0x09: 1,
  0x0a: 3, 0x0b: 3, 0x0c: 2, 0x0d: 2, 0x12: 2, 0x13: 2, 0x14: 2, 0x2e: 1, 0x2f: 1,
  0x3a: 1, 0x3d: 2, 0x3e: 4, 0x3f: 2,
  // binary sensors (1 byte each): 0x0F..0x2D
  0x0f: 1, 0x10: 1, 0x11: 1, 0x15: 1, 0x16: 1, 0x17: 1, 0x18: 1, 0x19: 1, 0x1a: 1, 0x1b: 1,
  0x1c: 1, 0x1d: 1, 0x1e: 1, 0x1f: 1, 0x20: 1, 0x21: 1, 0x22: 1, 0x23: 1, 0x24: 1, 0x25: 1,
  0x26: 1, 0x27: 1, 0x28: 1, 0x29: 1, 0x2a: 1, 0x2b: 1, 0x2c: 1, 0x2d: 1,
};

function decodeBTHome(dv: DataView): Partial<AdvReading> {
  const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
  const out: Partial<AdvReading> = { raw: [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('') };
  if (bytes.length === 0) return out;
  // Byte 0 = BTHome device-info: bit0 = encrypted (can't decode without the bindkey), bits5-7 = version.
  out.encrypted = (bytes[0] & 0x01) === 1;
  if (out.encrypted) return out;
  let i = 1;
  while (i < bytes.length) {
    const id = bytes[i++];
    const len = BTHOME_LEN[id];
    if (len === undefined || i + len > bytes.length) break; // unknown/overrun → stop (raw still logged)
    switch (id) {
      case 0x01: out.battery = bytes[i]; break;                                  // battery %
      case 0x02: out.temperature = dv.getInt16(i, true) * 0.01; break;           // temperature °C
      case 0x20: out.flood = bytes[i] === 1; break;                              // moisture (binary water leak)
      case 0x14: if (out.flood === undefined) out.flood = dv.getUint16(i, true) > 0; break; // moisture % (fallback)
    }
    i += len;
  }
  return out;
}

let advSubscribers: ((r: AdvReading) => void)[] = [];
let advStop: (() => Promise<void>) | null = null;

async function ensureAdvScan() {
  if (advStop) return;
  const BleClient = await client();
  await BleClient.requestLEScan({ allowDuplicates: true }, (r: any) => {
    try {
      const mac = normMac(r?.device?.deviceId || '');
      const sd = r?.serviceData || {};
      const md = r?.manufacturerData || {};
      // Path A — BTHome service data (0xFCD2): true Shelly BLU sensors broadcast clear telemetry here.
      const fcd2 = Object.keys(sd).find((k) => k.toLowerCase().includes('fcd2'));
      // Path B — Shelly manufacturer beacon, company 0x0BA9 (2985). HARDWARE-CONFIRMED on a Flood G4:
      // this beacon is STATIC (identical wet/dry) and carries NO telemetry — only presence + MAC. So
      // Gen4 wifi sensors need a GATT connect + Shelly.GetStatus for state; the beacon just tells us
      // the device is awake (a good trigger for that GATT read).
      const shellyMfg = md['2985'] || md['0BA9'] || md['0ba9'] || md['2985'.toLowerCase()];
      let reading: AdvReading | null = null;
      if (fcd2) {
        reading = { mac, raw: '', ...decodeBTHome(sd[fcd2]) } as AdvReading;
      } else if (shellyMfg) {
        reading = { mac, present: true, raw: String(shellyMfg) };
      }
      if (!reading) return;
      console.log('[shellyBle] adv', reading.mac, JSON.stringify(reading));
      advSubscribers.forEach((cb) => cb(reading!));
    } catch { /* ignore malformed adv */ }
  });
  advStop = async () => { try { await BleClient.stopLEScan(); } catch { /* ignore */ } };
}

/** Subscribe to decoded BTHome advertisements. Starts the shared scan; stops it when the last
 *  subscriber leaves. Returns an unsubscribe function. */
export async function subscribeAdvertisements(onReading: (r: AdvReading) => void): Promise<() => void> {
  advSubscribers.push(onReading);
  await ensureAdvScan();
  return () => {
    advSubscribers = advSubscribers.filter((c) => c !== onReading);
    if (advSubscribers.length === 0 && advStop) { advStop(); advStop = null; }
  };
}

// One RPC round-trip on an already-connected device.
async function rpcOnConnected(BleClient: typeof BleClientType, deviceId: string, method: string, params: any): Promise<any> {
  const req = enc.encode(JSON.stringify({ id: Math.floor(Math.random() * 1e6), src: 'brvg', method, params }));
  await BleClient.write(deviceId, SVC, CHAR_TX, u32be(req.length));
  const CHUNK = 20;
  for (let i = 0; i < req.length; i += CHUNK) {
    const slice = req.slice(i, i + CHUNK);
    await BleClient.write(deviceId, SVC, CHAR_DATA, new DataView(slice.buffer, slice.byteOffset, slice.byteLength));
  }
  // Wait for the device to populate the response length.
  let respLen = 0;
  for (let attempt = 0; attempt < 60 && respLen === 0; attempt++) {
    const rx = await BleClient.read(deviceId, SVC, CHAR_RX);
    respLen = rx.getUint32(0, false);
    if (respLen === 0) await wait(100);
  }
  if (respLen === 0) throw new Error('No BLE response from device');
  const buf = new Uint8Array(respLen);
  let got = 0, guard = 0;
  while (got < respLen && guard++ < 200) {
    const chunk = await BleClient.read(deviceId, SVC, CHAR_DATA);
    const bytes = new Uint8Array(chunk.buffer);
    if (bytes.length === 0) { await wait(50); continue; }
    buf.set(bytes.subarray(0, Math.min(bytes.length, respLen - got)), got);
    got += bytes.length;
  }
  const resp = JSON.parse(dec.decode(buf));
  console.log('[shellyBle]', method, '→', JSON.stringify(resp.error || resp.result));
  if (resp.error) throw new Error(resp.error.message || 'Shelly BLE RPC error');
  return resp.result;
}

/** Ask the device (over BLE) for the Wi-Fi networks it can see, deduped by SSID, strongest first. */
export async function bleScanWifi(deviceId: string): Promise<{ ssid: string; rssi: number }[]> {
  const BleClient = await client();
  await BleClient.connect(deviceId, undefined, { timeout: 12000 });
  try {
    const res = await rpcOnConnected(BleClient, deviceId, 'Wifi.Scan', {});
    const raw: any[] = res?.results || res?.aps || [];
    const best = new Map<string, number>();
    for (const ap of raw) {
      const s = (ap?.ssid || '').trim();
      if (!s) continue;
      const rssi = typeof ap?.rssi === 'number' ? ap.rssi : -100;
      if (!best.has(s) || rssi > (best.get(s) as number)) best.set(s, rssi);
    }
    const list = [...best.entries()].map(([ssid, rssi]) => ({ ssid, rssi })).sort((a, b) => b.rssi - a.rssi);
    console.log('[shellyBle] Wifi.Scan SSIDs:', list.map((l) => l.ssid).join(', '));
    return list;
  } finally {
    try { await BleClient.disconnect(deviceId); } catch { /* ignore */ }
  }
}

/**
 * Provision a Shelly over BLE: read device info, (optionally) create the cloud webhook, then push
 * Wi-Fi credentials so it joins the user's network. Returns Shelly.GetDeviceInfo for type detection.
 */
export async function bleProvision(
  deviceId: string,
  opts: { ssid: string; password: string; webhookBase?: string; vid?: string; onProgress?: (msg: string) => void },
): Promise<{ info: any; localIp?: string; lastStatus?: string }> {
  const BleClient = await client();
  await BleClient.connect(deviceId, undefined, { timeout: 12000 });
  try {
    const info = await rpcOnConnected(BleClient, deviceId, 'Shelly.GetDeviceInfo', {});

    // Register cloud-alert webhooks over BLE (while still connected) if configured + signed in.
    if (opts.webhookBase && opts.vid) {
      opts.onProgress?.('Setting up cloud alerts…');
      try {
        const { registerShellyWebhooks } = await import('./shellyRpc');
        const made = await registerShellyWebhooks((m, p) => rpcOnConnected(BleClient, deviceId, m, p), opts.webhookBase, opts.vid, info?.id || info?.mac || '');
        console.log('[shellyBle] registered webhooks:', made.join(', '));
      } catch (e) { console.log('[shellyBle] webhook setup failed (non-fatal)', e); }
    }

    opts.onProgress?.('Sending Wi-Fi credentials…');
    const setRes = await rpcOnConnected(BleClient, deviceId, 'Wifi.SetConfig', {
      config: { sta: { ssid: opts.ssid, pass: opts.password, is_open: opts.password.length === 0, enable: true } },
    });
    if (setRes?.restart_required) {
      try { await rpcOnConnected(BleClient, deviceId, 'Shelly.Reboot', {}); } catch { /* best-effort */ }
    }

    // Wait for it to actually join Wi-Fi and get a real DHCP address. 0.0.0.0 / empty means it's
    // still connecting, so keep polling (up to ~45s) until a real IP appears.
    opts.onProgress?.('Waiting for the device to join Wi-Fi…');
    let localIp: string | undefined;
    let lastErr = '';
    for (let i = 0; i < 18; i++) {
      await wait(2500);
      try {
        const st = await rpcOnConnected(BleClient, deviceId, 'Wifi.GetStatus', {});
        console.log('[shellyBle] Wifi.GetStatus →', JSON.stringify(st));
        const ip = st?.sta_ip;
        lastErr = st?.status || '';
        if (ip && ip !== '0.0.0.0') { localIp = ip; break; } // got a real address
      } catch {
        break; // BLE may drop once the radio switches to STA — that's fine
      }
    }
    if (!localIp && lastErr) console.log('[shellyBle] no IP yet, last status:', lastErr);
    return { info, localIp, lastStatus: lastErr };
  } finally {
    try { await BleClient.disconnect(deviceId); } catch { /* ignore */ }
  }
}
