// Temperature display unit resolution (owner request 2026-07-22).
//
// Three layers, most specific wins:
//   1. per-device override (DeviceConfig.tempUnit — set in Settings → Devices → Configuration);
//   2. the device-local preference `lt_temp_unit` ('c' | 'f'; anything else = auto);
//   3. auto: follow the volume unit system (`lt_unit` imperial → °F, metric → °C).
// Pure so every temp display (ShellyWidget, Overview tiles) resolves identically.

export type TempUnit = 'c' | 'f';

export function resolveTempUnit(
  device?: { tempUnit?: string } | null,
  storage: Pick<Storage, 'getItem'> = localStorage,
): TempUnit {
  const dev = device?.tempUnit;
  if (dev === 'c' || dev === 'f') return dev;
  const pref = storage.getItem('lt_temp_unit');
  if (pref === 'c' || pref === 'f') return pref;
  return (storage.getItem('lt_unit') || 'imperial') === 'imperial' ? 'f' : 'c';
}

/** Convert a Celsius reading to the display unit. */
export function cToDisplay(tC: number, unit: TempUnit): number {
  return unit === 'f' ? tC * 9 / 5 + 32 : tC;
}

export function tempUnitLabel(unit: TempUnit): string {
  return unit === 'f' ? '°F' : '°C';
}
