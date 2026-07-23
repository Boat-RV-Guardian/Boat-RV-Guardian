import { describe, it, expect, beforeEach } from 'vitest';
import {
  canManageWifi, loadVehicleWifi, saveVehicleWifi, clearVehicleWifi, wifiPrefill, wifiKey, maskSecret,
} from './vehicleWifi';
import { VEHICLE_KEYS } from './configSync';

const T0 = 1_800_000_000_000;

beforeEach(() => localStorage.clear());

describe('storage namespace (never synced)', () => {
  it('the key is NOT a synced vehicle config key', () => {
    // The whole privacy guarantee: getLocalVehicleConfig only uploads VEHICLE_KEYS.
    expect(VEHICLE_KEYS).not.toContain(wifiKey('v1'));
    expect(VEHICLE_KEYS.some((k) => k.startsWith('sh_wifi_'))).toBe(false);
  });

  it('lives in the sh_ namespace so applyUserScope wipes it on identity change', () => {
    expect(wifiKey('v1').startsWith('sh_')).toBe(true);
  });
});

describe('canManageWifi', () => {
  it('allows admin and control, denies monitor', () => {
    expect(canManageWifi('admin')).toBe(true);
    expect(canManageWifi('control')).toBe(true);
    expect(canManageWifi('monitor')).toBe(false);
  });
  it('treats an unset role as admin (legacy owner)', () => {
    expect(canManageWifi(null)).toBe(true);
    expect(canManageWifi(undefined)).toBe(true);
  });
});

describe('save / load', () => {
  it('round-trips and keeps vehicles independent', () => {
    saveVehicleWifi('v1', 'BoatNet', 'hunter2', T0);
    saveVehicleWifi('v2', 'RVNet', 'other', T0);
    expect(loadVehicleWifi('v1')).toEqual({ ssid: 'BoatNet', password: 'hunter2', savedAt: T0 });
    expect(loadVehicleWifi('v2')?.ssid).toBe('RVNet');
  });

  it('trims the SSID and keeps the password verbatim (no case mangling)', () => {
    saveVehicleWifi('v1', '  BoatNet  ', '  PaSsWoRd  ', T0);
    const rec = loadVehicleWifi('v1')!;
    expect(rec.ssid).toBe('BoatNet');
    expect(rec.password).toBe('  PaSsWoRd  '); // whitespace can be significant in a Wi-Fi password
  });

  it('supports an open network (blank password)', () => {
    saveVehicleWifi('v1', 'OpenNet', '', T0);
    expect(loadVehicleWifi('v1')).toEqual({ ssid: 'OpenNet', password: '', savedAt: T0 });
  });

  it('a blank SSID clears rather than storing a useless record', () => {
    saveVehicleWifi('v1', 'BoatNet', 'pw', T0);
    saveVehicleWifi('v1', '   ', 'pw', T0);
    expect(loadVehicleWifi('v1')).toBeNull();
  });

  it('returns null for unknown vehicles, blank ids and corrupt storage', () => {
    expect(loadVehicleWifi('nope')).toBeNull();
    expect(loadVehicleWifi('')).toBeNull();
    localStorage.setItem(wifiKey('v1'), '{not json');
    expect(loadVehicleWifi('v1')).toBeNull();
    localStorage.setItem(wifiKey('v2'), JSON.stringify({ ssid: 42 }));
    expect(loadVehicleWifi('v2')).toBeNull();
  });

  it('clearVehicleWifi removes only that vehicle', () => {
    saveVehicleWifi('v1', 'A', 'a', T0);
    saveVehicleWifi('v2', 'B', 'b', T0);
    clearVehicleWifi('v1');
    expect(loadVehicleWifi('v1')).toBeNull();
    expect(loadVehicleWifi('v2')?.ssid).toBe('B');
  });
});

describe('wifiPrefill', () => {
  it('returns the credentials for admin/control', () => {
    saveVehicleWifi('v1', 'BoatNet', 'pw', T0);
    expect(wifiPrefill('v1', 'admin')?.ssid).toBe('BoatNet');
    expect(wifiPrefill('v1', 'control')?.password).toBe('pw');
  });

  it('refuses a monitor even when credentials exist locally', () => {
    saveVehicleWifi('v1', 'BoatNet', 'pw', T0);
    expect(wifiPrefill('v1', 'monitor')).toBeNull();
  });
});

describe('maskSecret', () => {
  it('masks without leaking length beyond a cap, and passes blanks through', () => {
    expect(maskSecret('')).toBe('');
    expect(maskSecret('abc')).toBe('•••');
    expect(maskSecret('a'.repeat(40))).toHaveLength(12);
  });
});
