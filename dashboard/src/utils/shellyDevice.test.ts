import { describe, it, expect } from 'vitest';
import { deviceLocalHost, findVoltmeterId, detectRole } from './shellyDevice';
import type { DeviceConfig } from './VehicleManager';

const dev = (over: Partial<DeviceConfig>): DeviceConfig => ({ id: 'x', type: 'shelly_sensor', ...over } as DeviceConfig);

describe('deviceLocalHost', () => {
  it('prefers the configured local IP', () => {
    expect(deviceLocalHost(dev({ localIp: '192.168.1.50', shellyDeviceId: 'shellyplusuni-abc' }))).toBe('192.168.1.50');
  });

  it('derives a lowercased mDNS .local name from a shelly device id when no IP', () => {
    expect(deviceLocalHost(dev({ shellyDeviceId: 'ShellyPlusUni-AABBCC' }))).toBe('shellyplusuni-aabbcc.local');
  });

  it('returns empty string for a non-shelly id with no IP', () => {
    expect(deviceLocalHost(dev({ shellyDeviceId: 'taplinker-1' }))).toBe('');
  });

  it('returns empty string when neither IP nor shelly id is present', () => {
    expect(deviceLocalHost(dev({}))).toBe('');
  });
});

describe('findVoltmeterId', () => {
  it('extracts the numeric id from a voltmeter:N key', () => {
    expect(findVoltmeterId({ 'voltmeter:100': { voltage: 12.3 }, 'sys': {} })).toBe(100);
  });

  it('returns null when there is no voltmeter component', () => {
    expect(findVoltmeterId({ 'switch:0': {}, 'sys': {} })).toBeNull();
  });

  it('tolerates null/undefined status', () => {
    expect(findVoltmeterId(null)).toBeNull();
    expect(findVoltmeterId(undefined)).toBeNull();
  });
});

describe('detectRole', () => {
  it('detects flood sensors', () => {
    expect(detectRole({ id: 'shellyfloodg4-d885acea3914', app: 'FloodG4' })).toBe('Flood Sensor');
  });

  it('detects H&T environmental sensors (HTG3 + Plus H&T)', () => {
    expect(detectRole({ id: 'shellyhtg3-aabbccddeeff', app: 'HTG3' })).toBe('Environmental Sensor');
    expect(detectRole({ id: 'shellyplusht-a8032ab12345', app: 'PlusHT' })).toBe('Environmental Sensor');
  });

  it('detects Uni (low power) and PM/EM (high power)', () => {
    expect(detectRole({ id: 'shellyplusuni-f8b3b7fcfb74', app: 'PlusUni' })).toBe('Low Power Sensor');
    expect(detectRole({ id: 'shellypmminig3-dcb4d9db9850', app: 'PMMiniG3' })).toBe('High Power Sensor');
  });

  it('returns null for unknown devices (user keeps their pick)', () => {
    expect(detectRole({ id: 'shellyplug-s-123456', app: 'PlugS' })).toBeNull();
    expect(detectRole({})).toBeNull();
  });
});
