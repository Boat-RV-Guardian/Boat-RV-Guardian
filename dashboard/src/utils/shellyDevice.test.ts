import { describe, it, expect } from 'vitest';
import { deviceLocalHost, findVoltmeterId } from './shellyDevice';
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
