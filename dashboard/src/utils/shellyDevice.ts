// Pure helpers for addressing a Shelly device locally. Extracted from Settings.tsx (Task 3) so the
// host-resolution + voltmeter-component lookup are testable without any device RPC.

import type { DeviceConfig } from './VehicleManager';

// The local host to talk to a Shelly device: its configured IP if known, else the mDNS `.local`
// name derived from a `shelly*` device id, else '' (no local address).
export function deviceLocalHost(d: DeviceConfig): string {
  return d.localIp || (d.shellyDeviceId && /shelly/i.test(d.shellyDeviceId) ? `${d.shellyDeviceId.toLowerCase()}.local` : '');
}

// Map a Shelly device's reported identity (Shelly.GetDeviceInfo) to one of our sensor roles.
// Returns null when we can't confidently tell (the user then keeps whatever they picked).
// Moved from ProvisionShellyModal so role detection is unit-testable.
export function detectRole(info: any): string | null {
  const hay = `${info?.app || ''} ${info?.model || ''} ${info?.id || ''}`.toLowerCase();
  if (hay.includes('flood')) return 'Flood Sensor';
  // H&T temp/humidity sensors: app "HT"/"HTG3", ids like shellyhtg3-… / shellyplusht-…
  if (/htg\d|plusht|shellyht|h&t/.test(hay)) return 'Environmental Sensor';
  if (hay.includes('uni')) return 'Low Power Sensor';                 // Plus Uni → DC 12-24V monitoring
  if (hay.includes('em') || hay.includes('pm')) return 'High Power Sensor'; // mains energy/power meter
  return null;
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
