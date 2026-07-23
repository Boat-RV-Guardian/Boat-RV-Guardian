import { describe, it, expect, beforeEach } from 'vitest';
import { sensorReading } from './sensorDisplay';
import type { DeviceConfig } from './VehicleManager';

const dev = (role: string): DeviceConfig => ({ id: 'd1', type: 'shelly_sensor', role, name: 'Test' } as DeviceConfig);

beforeEach(() => localStorage.clear());

describe('sensorReading — High Power Sensor (shore)', () => {
  it('classifies normal / low / crit-low against the shore thresholds', () => {
    const ok = sensorReading(dev('High Power Sensor'), { 'pm1:0': { voltage: 120.4 } });
    expect(ok.primary).toBe('120.4');
    expect(ok.unit).toBe('V');
    expect(ok.badge?.t).toBe('NORMAL');
    expect(ok.level).toBe('ok');
    expect(ok.value).toBeCloseTo(120.4);

    expect(sensorReading(dev('High Power Sensor'), { 'pm1:0': { voltage: 110 } }).badge?.t).toBe('LOW');
    const crit = sensorReading(dev('High Power Sensor'), { 'pm1:0': { voltage: 100 } });
    expect(crit.badge?.t).toBe('CRIT LOW');
    expect(crit.level).toBe('crit');
    expect(sensorReading(dev('High Power Sensor'), { 'pm1:0': { voltage: 133 } }).badge?.t).toBe('CRIT HIGH');
  });

  it('honors customized thresholds from storage', () => {
    localStorage.setItem('lt_shore_low_v', '100');
    expect(sensorReading(dev('High Power Sensor'), { 'pm1:0': { voltage: 110 } }).badge?.t).toBe('NORMAL');
  });
});

describe('sensorReading — Low Power Sensor (battery)', () => {
  it('reads xvoltage first and classifies charging', () => {
    const r = sensorReading(dev('Low Power Sensor'), { 'voltmeter:100': { xvoltage: 13.8, voltage: 13.5 } });
    expect(r.primary).toBe('13.80');
    expect(r.badge?.t).toBe('CHARGING');
    expect(r.level).toBe('ok');
  });

  it('classifies critical + falls back to the Uni analog input estimate', () => {
    const crit = sensorReading(dev('Low Power Sensor'), { 'voltmeter:100': { voltage: 11.5 } });
    expect(crit.badge?.t).toBe('CRITICAL');
    expect(crit.level).toBe('crit');
    // Uni analog: percent of the 30 V full-scale
    const uni = sensorReading(dev('Low Power Sensor'), { 'input:1': { percent: 42 } });
    expect(uni.value).toBeCloseTo(12.6);
  });
});

describe('sensorReading — Flood Sensor', () => {
  it('dry shows sensor battery and ok level', () => {
    const r = sensorReading(dev('Flood Sensor'), { 'flood:0': { alarm: false }, 'devicepower:0': { battery: { percent: 87 } } });
    expect(r.primary).toBe('Dry');
    expect(r.secondary).toContain('87%');
    expect(r.badge?.t).toBe('DRY');
    expect(r.level).toBe('ok');
    expect(r.value).toBe(0);
  });

  it('wet is critical', () => {
    const r = sensorReading(dev('Flood Sensor'), { 'flood:0': { alarm: true } });
    expect(r.primary).toBe('Wet');
    expect(r.badge?.t).toBe('FLOOD');
    expect(r.level).toBe('crit');
    expect(r.value).toBe(1);
  });
});

describe('sensorReading — Environmental Sensor', () => {
  it('converts to the display unit and flags freeze risk', () => {
    localStorage.setItem('lt_temp_unit', 'f');
    const r = sensorReading(dev('Environmental Sensor'), { 'temperature:0': { tC: 20 }, 'humidity:0': { rh: 54 } });
    expect(r.primary).toBe('68.0');
    expect(r.unit).toBe('°F');
    expect(r.secondary).toContain('54%');
    expect(r.level).toBe('ok');

    const freeze = sensorReading(dev('Environmental Sensor'), { 'temperature:0': { tC: 0.5 } });
    expect(freeze.badge?.t).toBe('FREEZE RISK');
    expect(freeze.level).toBe('crit');
  });
});

describe('sensorReading — no data', () => {
  it('returns the empty reading', () => {
    const r = sensorReading(dev('High Power Sensor'), null);
    expect(r.primary).toBe('—');
    expect(r.value).toBeNull();
    expect(r.level).toBe('none');
  });
});
