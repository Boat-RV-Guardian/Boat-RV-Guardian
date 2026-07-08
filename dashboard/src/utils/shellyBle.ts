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
// NOTE: BLE is used ONLY for pairing/onboarding (provisioning) now. The offline BLE
// advertisement/BTHome telemetry path was removed — Gen4 wifi sensors don't broadcast
// state in the clear (hardware-confirmed: static Shelly beacon), so device state comes
// over IP (local webhook + Shelly.GetStatus strike, cloud webhook/FCM, cached state).
// ---------------------------------------------------------------------------

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

/** A Plus Uni needs its voltmeter PERIPHERAL linked before webhooks make sense (see bleProvision). */
export const isShellyUni = (info: any): boolean => /uni/i.test(String(info?.app || info?.model || ''));

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

    // Plus Uni: do NOTHING device-specific over BLE. Enabling the voltmeter here (tried 2026-07-08)
    // broke provisioning both ways on live hardware: AddPeripheral leaves a pending restart, so
    // Wifi.SetConfig reports restart_required and the immediate reboot kills the BLE session before
    // the IP is learned; and on a re-provision, its Shelly.GetStatus probe (a large payload) is
    // unreliable over the 20-byte GATT chunking. The Uni's voltmeter + webhooks + password are all
    // handled over HTTP after the join (ProvisionShellyModal), in the #95 order — idempotent and on
    // a transport that can actually carry them. A mains-powered Uni stays awake, so post-join HTTP
    // is dependable for it (unlike battery sleepers).
    const uni = isShellyUni(info);

    // Register cloud-alert webhooks over BLE (while still connected) if configured + signed in.
    // NOT for a Uni — its voltmeter.* events don't exist until the post-join reboot activates the
    // peripheral, so registering now would fill the slots with input.* junk. The modal registers the
    // Uni's hooks over HTTP after the join instead. Flood sensors (which deep-sleep once provisioning
    // ends, making post-join HTTP unreliable) keep this BLE-time registration — flood.* events exist
    // out of the box.
    if (opts.webhookBase && opts.vid && !uni) {
      opts.onProgress?.('Setting up cloud alerts…');
      try {
        const { registerShellyWebhooks } = await import('./shellyRpc');
        const webhookSecret = (await import('./webhookSecret')).ensureWebhookSecret();
        const made = await registerShellyWebhooks((m, p) => rpcOnConnected(BleClient, deviceId, m, p), opts.webhookBase, opts.vid, info?.id || info?.mac || '', '', webhookSecret);
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
    // still connecting, so keep polling (up to ~60s) until a real IP appears. The BLE link can DROP
    // mid-poll — a restart_required reboot, or the radio switching to STA — so on an error we
    // RECONNECT (up to 3 times) and resume polling instead of giving up: losing the IP here used to
    // skip the whole post-join HTTP finish (webhooks/password) on 2026-07-08 live hardware.
    opts.onProgress?.('Waiting for the device to join Wi-Fi…');
    let localIp: string | undefined;
    let lastErr = '';
    let reconnects = 0;
    for (let i = 0; i < 24; i++) {
      await wait(2500);
      try {
        const st = await rpcOnConnected(BleClient, deviceId, 'Wifi.GetStatus', {});
        console.log('[shellyBle] Wifi.GetStatus →', JSON.stringify(st));
        const ip = st?.sta_ip;
        lastErr = st?.status || '';
        if (ip && ip !== '0.0.0.0') { localIp = ip; break; } // got a real address
      } catch {
        if (reconnects >= 3) break;
        reconnects++;
        opts.onProgress?.('Reconnecting to the device…');
        try { await BleClient.disconnect(deviceId); } catch { /* already gone */ }
        await wait(4000); // give a rebooting device time to come back up + advertise
        try { await BleClient.connect(deviceId, undefined, { timeout: 12000 }); } catch { break; }
      }
    }
    if (!localIp && lastErr) console.log('[shellyBle] no IP yet, last status:', lastErr);
    return { info, localIp, lastStatus: lastErr };
  } finally {
    try { await BleClient.disconnect(deviceId); } catch { /* ignore */ }
  }
}
