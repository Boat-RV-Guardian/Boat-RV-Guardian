import { describe, it, expect } from 'vitest';
import {
  wobble,
  demoValveWatering,
  demoValveFlow,
  demoValveBattery,
  demoSignal,
  demoLinkTapDoc,
  demoVoltage,
  demoTempC,
  demoShellyDoc,
  demoFloodAlarmActive,
  sampleBack,
  DEMO_VALVE_CYCLE_MS,
  DEMO_VALVE_WATER_MS,
  DEMO_SCENARIO_CYCLE_MS,
  DEMO_FLOOD_START_MS,
  DEMO_FLOOD_DURATION_MS,
  type DemoSensorSpec,
} from './demoTelemetry';
import { mergeLinkTapSensorDoc } from './linktapCloudState';

describe('wobble', () => {
  it('is 0 at t=0 and ±amp at the quarter/three-quarter period', () => {
    expect(wobble(0, 1000, 5)).toBe(0);
    expect(wobble(250, 1000, 5)).toBeCloseTo(5);
    expect(wobble(750, 1000, 5)).toBeCloseTo(-5);
  });
  it('is deterministic', () => {
    expect(wobble(123456, 9000, 2)).toBe(wobble(123456, 9000, 2));
  });
});

describe('demo valve', () => {
  it('waters at the top of each cycle and is idle after the burst', () => {
    expect(demoValveWatering(0)).toBe(true);
    expect(demoValveWatering(DEMO_VALVE_WATER_MS - 1)).toBe(true);
    expect(demoValveWatering(DEMO_VALVE_WATER_MS)).toBe(false);
    expect(demoValveWatering(DEMO_VALVE_CYCLE_MS - 1)).toBe(false);
    // wraps into the next cycle
    expect(demoValveWatering(DEMO_VALVE_CYCLE_MS)).toBe(true);
  });

  it('flows only while watering', () => {
    expect(demoValveFlow(0)).toBe(7.5);
    expect(demoValveFlow(0)).toBeGreaterThan(0);
    expect(demoValveFlow(DEMO_VALVE_WATER_MS)).toBe(0);
  });

  it('reports battery and signal in believable bands', () => {
    for (const t of [0, 5 * 60_000, 3_600_000, 123_456_789]) {
      expect(demoValveBattery(t)).toBeGreaterThanOrEqual(93);
      expect(demoValveBattery(t)).toBeLessThanOrEqual(99);
      expect(demoSignal(t)).toBeGreaterThanOrEqual(64);
      expect(demoSignal(t)).toBeLessThanOrEqual(80);
    }
  });

  it('emits a doc the app’s LinkTap merger consumes as a coherent state', () => {
    const open = mergeLinkTapSensorDoc(null, demoLinkTapDoc(0));
    expect(open).toMatchObject({ isWatering: true, flow: 7.5, workMode: 'M' });
    expect(open!.battery).toBeGreaterThan(0);

    const closed = mergeLinkTapSensorDoc(open, demoLinkTapDoc(DEMO_VALVE_WATER_MS));
    expect(closed).toMatchObject({ isWatering: false, flow: 0, event: 'wateringOff' });
  });
});

describe('scripted flood incident', () => {
  it('alarms only inside the flood window of each scenario cycle', () => {
    expect(demoFloodAlarmActive(0)).toBe(false);
    expect(demoFloodAlarmActive(DEMO_FLOOD_START_MS - 1)).toBe(false);
    expect(demoFloodAlarmActive(DEMO_FLOOD_START_MS)).toBe(true);
    expect(demoFloodAlarmActive(DEMO_FLOOD_START_MS + DEMO_FLOOD_DURATION_MS - 1)).toBe(true);
    expect(demoFloodAlarmActive(DEMO_FLOOD_START_MS + DEMO_FLOOD_DURATION_MS)).toBe(false);
    // wraps into the next cycle
    expect(demoFloodAlarmActive(DEMO_SCENARIO_CYCLE_MS + DEMO_FLOOD_START_MS)).toBe(true);
  });

  it('forces the valve shut (safety shutoff) while the flood is active', () => {
    const doc = demoLinkTapDoc(DEMO_FLOOD_START_MS + 5000);
    expect(doc).toMatchObject({ watering: '0', flow: '0', event: 'water cut-off alert', alarm: 'floodShutoff', kind: 'alarm' });
    const s = mergeLinkTapSensorDoc(null, doc);
    expect(s).toMatchObject({ isWatering: false, alarm: 'floodShutoff' });
  });
});

describe('demo Shelly voltages & temperature', () => {
  const shore: DemoSensorSpec = { deviceId: 'x', kind: 'shore', base: 120 };
  const house: DemoSensorSpec = { deviceId: 'x', kind: 'battery', base: 12.5, solar: true };
  const engine: DemoSensorSpec = { deviceId: 'x', kind: 'battery', base: 12.8 };
  const cabin: DemoSensorSpec = { deviceId: 'x', kind: 'thermo', base: 21 };

  it('sits at its nominal value at t=0 and stays within a tight band', () => {
    expect(demoVoltage(shore, 0)).toBe(120);
    expect(demoVoltage(engine, 0)).toBe(12.8);
    // solar battery: 12.5 at midnight, climbs up to ~+0.8V across the day
    expect(demoVoltage(house, 0)).toBe(12.5);
    for (const t of [0, 6 * 3_600_000, 12 * 3_600_000, 18 * 3_600_000]) {
      expect(demoVoltage(house, t)).toBeGreaterThanOrEqual(12.4);
      expect(demoVoltage(house, t)).toBeLessThanOrEqual(13.4);
      expect(demoVoltage(shore, t)).toBeGreaterThan(117);
      expect(demoVoltage(shore, t)).toBeLessThan(123);
    }
  });

  it('produces a gentle diurnal temperature swing', () => {
    expect(demoTempC(cabin, 0)).toBe(19);
    for (const t of [0, 6 * 3_600_000, 12 * 3_600_000, 18 * 3_600_000]) {
      expect(demoTempC(cabin, t)).toBeGreaterThanOrEqual(18);
      expect(demoTempC(cabin, t)).toBeLessThanOrEqual(24);
    }
  });
});

describe('demoShellyDoc', () => {
  it('shapes shore power as a pm1 voltage doc', () => {
    const d = demoShellyDoc({ deviceId: 'x', kind: 'shore', base: 120 }, 0);
    expect(d).toMatchObject({ event: 'pm1.voltage_change', v: '120', vraw: '120', at: '0' });
  });

  it('shapes a battery as a voltmeter doc', () => {
    const d = demoShellyDoc({ deviceId: 'x', kind: 'battery', base: 12.8 }, 0);
    expect(d).toMatchObject({ event: 'voltmeter.change', v: '12.8', vraw: '12.8' });
    expect(d.tC).toBeUndefined();
  });

  it('adds a temperature reading to a battery configured with tempBaseC', () => {
    const d = demoShellyDoc({ deviceId: 'x', kind: 'battery', base: 12.5, tempBaseC: 21 }, 0);
    expect(d.event).toBe('voltmeter.change');
    expect(Number(d.tC)).toBe(19); // 21 + 4·(diurnal(0)-0.5) = 21 - 2
  });

  it('flood is dry by default and alarms when scripted (as the widget’s regex reads it)', () => {
    const dry = demoShellyDoc({ deviceId: 'x', kind: 'flood', base: 0 }, 0);
    const wet = demoShellyDoc({ deviceId: 'x', kind: 'flood', base: 0 }, 0, true);
    // ShellyWidget: alarm = !/off|clear|inactive|dry/i.test(event) when /flood|alarm|leak/i matches
    const alarmOf = (ev: string) => /flood|alarm|leak/i.test(ev) && !/off|clear|inactive|dry/i.test(ev);
    expect(alarmOf(dry.event)).toBe(false);
    expect(alarmOf(wet.event)).toBe(true);
  });
});

describe('sampleBack', () => {
  it('returns points oldest-first ending at endT, deterministically', () => {
    const s1 = sampleBack((t) => demoVoltage({ deviceId: 'x', kind: 'shore', base: 120 }, t), 100_000, 5, 1000);
    expect(s1).toHaveLength(5);
    expect(s1[0].t).toBe(96_000);
    expect(s1[4].t).toBe(100_000);
    const s2 = sampleBack((t) => demoVoltage({ deviceId: 'x', kind: 'shore', base: 120 }, t), 100_000, 5, 1000);
    expect(s2).toEqual(s1);
  });
});
