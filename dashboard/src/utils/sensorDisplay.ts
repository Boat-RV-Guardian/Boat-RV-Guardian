import type { DeviceConfig } from './VehicleManager';
import { resolveTempUnit, cToDisplay, tempUnitLabel } from './tempUnit';

// Role-aware mapping of a Shelly status payload (local RPC shape or mapCloudSensorDoc output) to a
// display reading for the Dashboard metric cards. Extracted from the old Home.ShellyTile so the
// thresholds/badges live in ONE tested place and the card gets a numeric `value` for history.

export interface TileBadge { t: string; c: string }

export type TileLevel = 'ok' | 'warn' | 'crit' | 'none';

export interface TileReading {
  /** Big display value (already formatted, without the unit). */
  primary: string;
  /** Unit rendered after the primary value ('' when the primary is a word like Dry/Wet). */
  unit: string;
  /** Context line under the value. */
  secondary: string;
  badge: TileBadge | null;
  /** Numeric series value for the reading-history sparkline (null = nothing to record). */
  value: number | null;
  level: TileLevel;
}

const num = (key: string, dflt: number, storage: Storage) => Number(storage.getItem(key) ?? dflt) || dflt;

// Shelly Plus UNI has no Voltmeter component — its 0-30 V reading is an input of type "analog"
// (input:N { percent }). Mirror of ShellyWidget.uniAnalogVolts. See CLAUDE.md / shellyRpc.ts.
const uniAnalogVolts = (d: any, storage: Storage): number | null => {
  for (let i = 0; i < 5; i++) {
    const inp = d?.[`input:${i}`];
    if (inp && typeof inp.percent === 'number') return (inp.percent / 100) * num('lt_uni_volt_fullscale', 30, storage);
  }
  return null;
};

const levelForColor = (c: string): TileLevel =>
  c === '#ef4444' ? 'crit' : c === '#f59e0b' ? 'warn' : 'ok';

export function sensorReading(device: DeviceConfig, data: any, storage: Storage = localStorage): TileReading {
  const none: TileReading = { primary: '—', unit: '', secondary: '', badge: null, value: null, level: 'none' };
  if (!data) return none;

  if (device.role === 'High Power Sensor') {
    // Voltage-only shore-power install (not wired inline for current) — show volts, not watts.
    const v = data['pm1:0']?.voltage ?? data['switch:0']?.voltage ?? data['em:0']?.a_voltage ?? data.meters?.[0]?.voltage ?? 0;
    const cl = num('lt_shore_crit_low_v', 104, storage), lo = num('lt_shore_low_v', 114, storage),
      hi = num('lt_shore_high_v', 126, storage), ch = num('lt_shore_crit_high_v', 132, storage);
    const badge = v <= cl ? { t: 'CRIT LOW', c: '#ef4444' } : v <= lo ? { t: 'LOW', c: '#f59e0b' }
      : v >= ch ? { t: 'CRIT HIGH', c: '#ef4444' } : v >= hi ? { t: 'HIGH', c: '#f59e0b' } : { t: 'NORMAL', c: '#10b981' };
    return { primary: Number(v).toFixed(1), unit: 'V', secondary: 'Shore power', badge, value: Number(v), level: levelForColor(badge.c) };
  }

  if (device.role === 'Low Power Sensor') {
    const v = data['voltmeter:0']?.xvoltage ?? data['voltmeter:0']?.voltage
      ?? data['voltmeter:100']?.xvoltage ?? data['voltmeter:100']?.voltage
      ?? data.adcs?.[0]?.voltage ?? uniAnalogVolts(data, storage) ?? 0;
    const crit = num('lt_batt_crit_v', 11.8, storage), low = num('lt_batt_low_v', 12.2, storage),
      charge = num('lt_batt_charge_v', 13.6, storage), over = num('lt_batt_over_v', 15.0, storage);
    const badge = v <= crit ? { t: 'CRITICAL', c: '#ef4444' } : v <= low ? { t: 'LOW', c: '#f59e0b' }
      : v >= over ? { t: 'OVER', c: '#ef4444' } : v >= charge ? { t: 'CHARGING', c: '#22d3ee' } : { t: 'NORMAL', c: '#10b981' };
    return { primary: Number(v).toFixed(2), unit: 'V', secondary: 'House battery', badge, value: Number(v), level: levelForColor(badge.c) };
  }

  if (device.role === 'Flood Sensor') {
    const wet = !!(data['flood:0']?.alarm ?? data.flood?.alarm ?? false);
    const batt = data['devicepower:0']?.battery?.percent ?? data.device_power?.battery?.percent ?? data.bat?.value ?? null;
    return {
      primary: wet ? 'Wet' : 'Dry',
      unit: '',
      secondary: batt != null ? `Sensor battery ${batt}%` : 'Bilge / hull',
      badge: wet ? { t: 'FLOOD', c: '#ef4444' } : { t: 'DRY', c: '#3b82f6' },
      value: wet ? 1 : 0,
      level: wet ? 'crit' : 'ok',
    };
  }

  if (device.role === 'Environmental Sensor') {
    const tC = data['temperature:0']?.tC ?? data.tmp?.tC ?? null;
    const rh = data['humidity:0']?.rh ?? data.hum?.value ?? null;
    const tu = resolveTempUnit(device, storage);
    const freeze = tC != null && tC <= 1;
    return {
      primary: tC != null ? cToDisplay(tC, tu).toFixed(1) : '—',
      unit: tC != null ? tempUnitLabel(tu) : '',
      secondary: rh != null ? `Humidity ${Number(rh).toFixed(0)}%` : 'Climate',
      badge: freeze ? { t: 'FREEZE RISK', c: '#ef4444' } : null,
      value: tC != null ? cToDisplay(tC, tu) : null,
      level: freeze ? 'crit' : tC != null ? 'ok' : 'none',
    };
  }

  return none;
}
