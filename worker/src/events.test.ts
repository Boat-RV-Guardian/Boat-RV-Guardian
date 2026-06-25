import { describe, it, expect } from 'vitest';
import {
  isFloodShutoff,
  isTelemetry,
  isAlarmCleared,
  extractSensorStateExtras,
  sanitizeDevice,
} from './events';

describe('isFloodShutoff', () => {
  it('triggers on real flood/leak/alarm events', () => {
    expect(isFloodShutoff('flood.alarm')).toBe(true);
    expect(isFloodShutoff('flood')).toBe(true);
    expect(isFloodShutoff('leak.detected')).toBe(true);
    expect(isFloodShutoff('sensor.alarm')).toBe(true);
  });

  it('does NOT trigger on the cleared/dried-out (*_off) variant', () => {
    // Regression: FLOOD_EVENT_RE matches flood.alarm_off too, which fired a redundant close.
    expect(isFloodShutoff('flood.alarm_off')).toBe(false);
    expect(isFloodShutoff('leak.alarm_off')).toBe(false);
    expect(isFloodShutoff('alarm.off')).toBe(false);
  });

  it('does NOT trigger on periodic telemetry', () => {
    expect(isFloodShutoff('voltmeter.measurement')).toBe(false);
    expect(isFloodShutoff('voltmeter.change')).toBe(false);
  });

  it('does NOT trigger on unrelated events', () => {
    expect(isFloodShutoff('button.push')).toBe(false);
    expect(isFloodShutoff('temperature.update')).toBe(false);
    expect(isFloodShutoff('sensor alert')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isFloodShutoff('FLOOD.ALARM')).toBe(true);
    expect(isFloodShutoff('Flood.Alarm_Off')).toBe(false);
  });
});

describe('isAlarmCleared', () => {
  it('matches _off / .off suffixes only', () => {
    expect(isAlarmCleared('flood.alarm_off')).toBe(true);
    expect(isAlarmCleared('relay.off')).toBe(true);
    expect(isAlarmCleared('flood.alarm')).toBe(false);
    expect(isAlarmCleared('offline.event')).toBe(false); // "off" not at the end
  });
});

describe('isTelemetry', () => {
  it('matches .measurement / .change only', () => {
    expect(isTelemetry('voltmeter.measurement')).toBe(true);
    expect(isTelemetry('temperature.change')).toBe(true);
    expect(isTelemetry('flood.alarm')).toBe(false);
    expect(isTelemetry('measurement.start')).toBe(false); // not the suffix
  });
});

describe('extractSensorStateExtras', () => {
  it('keeps telemetry params, drops routing params', () => {
    const params = new URLSearchParams('vid=v_1&event=voltmeter.measurement&device=abc&v=12.6&vraw=12.28&tC=21');
    expect(extractSensorStateExtras(params)).toEqual({ v: '12.6', vraw: '12.28', tC: '21' });
  });

  it('skips empty and "null" placeholder values', () => {
    const params = new URLSearchParams('vid=v_1&v=&vraw=null&tC=20');
    expect(extractSensorStateExtras(params)).toEqual({ tC: '20' });
  });

  it('returns an empty object when only routing params are present', () => {
    const params = new URLSearchParams('vid=v_1&event=flood.alarm&device=abc');
    expect(extractSensorStateExtras(params)).toEqual({});
  });
});

describe('sanitizeDevice', () => {
  it('defaults to "unknown" when missing', () => {
    expect(sanitizeDevice(null)).toBe('unknown');
    expect(sanitizeDevice(undefined)).toBe('unknown');
    expect(sanitizeDevice('')).toBe('unknown');
  });

  it('replaces path-significant characters', () => {
    expect(sanitizeDevice('a/b#c?d')).toBe('a_b_c_d');
    expect(sanitizeDevice('shellyfloodg4-d885acea3914')).toBe('shellyfloodg4-d885acea3914');
  });
});
