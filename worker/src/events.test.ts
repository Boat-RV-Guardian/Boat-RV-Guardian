import { describe, it, expect } from 'vitest';
import {
  isFloodShutoff,
  isTelemetry,
  isAlarmCleared,
  extractSensorStateExtras,
  sanitizeDevice,
  sanitizeVid,
  telemetryResolutionSecForTier,
  shouldPersistTelemetry,
  healthBody,
  WORKER_SERVICE,
  smsEventKey,
  buildLastSendField,
} from './events';

describe('smsEventKey', () => {
  it('maps the flood family to flood (not the cleared/telemetry variants)', () => {
    expect(smsEventKey('flood.alarm')).toBe('flood');
    expect(smsEventKey('leak')).toBe('flood');
    expect(smsEventKey('flood.alarm_off')).toBeNull(); // cleared
    expect(smsEventKey('flood.measurement')).toBeNull(); // telemetry
  });
  it('maps low-battery / shore-power / offline events', () => {
    expect(smsEventKey('low_battery')).toBe('low_battery');
    expect(smsEventKey('battery.low')).toBe('low_battery');
    expect(smsEventKey('shore.power.lost')).toBe('shore_power');
    expect(smsEventKey('device.offline')).toBe('offline');
  });
  it('returns null for unmapped / empty events', () => {
    expect(smsEventKey('button.push')).toBeNull();
    expect(smsEventKey('')).toBeNull();
    expect(smsEventKey('voltmeter.change')).toBeNull(); // telemetry
  });
});

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
  it('keeps telemetry params, drops routing + auth params', () => {
    const params = new URLSearchParams('vid=v_1&event=voltmeter.measurement&device=abc&key=secret&v=12.6&vraw=12.28&tC=21');
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

describe('telemetryResolutionSecForTier', () => {
  it('maps known tiers', () => {
    expect(telemetryResolutionSecForTier('free')).toBe(1800);
    expect(telemetryResolutionSecForTier('basic')).toBe(300);
    expect(telemetryResolutionSecForTier('premium')).toBe(60);
  });
  it('defaults unknown/legacy to premium cadence (unchanged behavior for grandfathered)', () => {
    expect(telemetryResolutionSecForTier(undefined)).toBe(60);
    expect(telemetryResolutionSecForTier(null)).toBe(60);
    expect(telemetryResolutionSecForTier('gold')).toBe(60);
  });
});

describe('shouldPersistTelemetry', () => {
  it('persists when there is no prior write', () => {
    expect(shouldPersistTelemetry(1_000_000, null, 300)).toBe(true);
    expect(shouldPersistTelemetry(1_000_000, undefined, 300)).toBe(true);
  });
  it('persists once the resolution window has elapsed', () => {
    const last = 1_000_000;
    expect(shouldPersistTelemetry(last + 300_000, last, 300)).toBe(true); // exactly 300s
    expect(shouldPersistTelemetry(last + 400_000, last, 300)).toBe(true);
  });
  it('skips within the resolution window', () => {
    const last = 1_000_000;
    expect(shouldPersistTelemetry(last + 60_000, last, 300)).toBe(false); // 60s < 300s
    expect(shouldPersistTelemetry(last + 299_000, last, 300)).toBe(false);
  });
  it('persists defensively on non-finite timestamps', () => {
    expect(shouldPersistTelemetry(NaN, 1_000_000, 300)).toBe(true);
    expect(shouldPersistTelemetry(1_000_000, Infinity, 300)).toBe(true);
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

describe('sanitizeVid', () => {
  it('stays empty when missing (so the caller 404s instead of hitting a doc path)', () => {
    expect(sanitizeVid(null)).toBe('');
    expect(sanitizeVid(undefined)).toBe('');
    expect(sanitizeVid('')).toBe('');
  });

  it('passes real vehicle ids through unchanged', () => {
    expect(sanitizeVid('v_uusajkm88')).toBe('v_uusajkm88');
  });

  it('neutralizes path/URL-significant characters (path-injection guard)', () => {
    expect(sanitizeVid('../users/victim')).toBe('.._users_victim');
    expect(sanitizeVid('a/b#c?d')).toBe('a_b_c_d');
  });
});

describe('healthBody', () => {
  it('returns an ok liveness payload echoing the given time', () => {
    expect(healthBody(1719360000000)).toEqual({ ok: true, service: WORKER_SERVICE, time: 1719360000000 });
  });
});

describe('buildLastSendField', () => {
  it('value-wraps every input field into a Firestore mapValue', () => {
    expect(buildLastSendField({
      event: 'flood.alarm', at: 1719360000000, fcmSent: 2, fcmFailed: 1, smsAttempted: 1, smsSent: 1,
    })).toEqual({
      mapValue: {
        fields: {
          event: { stringValue: 'flood.alarm' },
          at: { integerValue: '1719360000000' },
          fcmSent: { integerValue: '2' },
          fcmFailed: { integerValue: '1' },
          smsAttempted: { integerValue: '1' },
          smsSent: { integerValue: '1' },
        },
      },
    });
  });

  it('represents all-zero / no-op-free counts as zero integerValues, not omitted', () => {
    const out = buildLastSendField({ event: 'button.push', at: 0, fcmSent: 0, fcmFailed: 0, smsAttempted: 0, smsSent: 0 });
    expect(out.mapValue.fields.fcmSent).toEqual({ integerValue: '0' });
    expect(out.mapValue.fields.smsSent).toEqual({ integerValue: '0' });
  });
});
