// Pure helpers for addressing a Shelly device locally. Extracted from Settings.tsx (Task 3) so the
// host-resolution + voltmeter-component lookup are testable without any device RPC.

import type { DeviceConfig } from './VehicleManager';

// The local host to talk to a Shelly device: its configured IP if known, else the mDNS `.local`
// name derived from a `shelly*` device id, else '' (no local address).
export function deviceLocalHost(d: DeviceConfig): string {
  return d.localIp || (d.shellyDeviceId && /shelly/i.test(d.shellyDeviceId) ? `${d.shellyDeviceId.toLowerCase()}.local` : '');
}

// Find the device's voltmeter component id from a Shelly.GetStatus payload (peripheral-linked →
// usually 100). Returns null when no `voltmeter:N` key is present.
export function findVoltmeterId(status: any): number | null {
  for (const k of Object.keys(status || {})) {
    const m = /^voltmeter:(\d+)$/.exec(k);
    if (m) return Number(m[1]);
  }
  return null;
}
