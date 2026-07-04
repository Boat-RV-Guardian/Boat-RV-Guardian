import { describe, it, expect } from 'vitest';
import { mergeLinkTapSensorDoc, linkTapSensorStateKey, type LinkTapCloudState } from './linktapCloudState';

describe('mergeLinkTapSensorDoc', () => {
  it('builds initial state from a wateringOn doc', () => {
    const s = mergeLinkTapSensorDoc(null, { event: 'wateringOn', at: '1000', watering: '1', battery: '96', signal: '-44', kind: 'watering' });
    expect(s).toMatchObject({ event: 'wateringOn', at: 1000, isWatering: true, battery: 96, signal: -44 });
  });

  it('keeps the sticky watering state across a flow-only update, and updates flow', () => {
    const on = mergeLinkTapSensorDoc(null, { event: 'wateringOn', at: '1000', watering: '1', battery: '96' })!;
    // A flowMeterValue doc carries only flow (+ kind/at) — watering/battery must persist.
    const flow = mergeLinkTapSensorDoc(on, { event: 'flowMeterValue', at: '1005', flow: '3.4', kind: 'telemetry' })!;
    expect(flow).toMatchObject({ isWatering: true, battery: 96, flow: 3.4, event: 'flowMeterValue', at: 1005 });
  });

  it('clears watering on a wateringOff and retains battery/signal from it', () => {
    const on = mergeLinkTapSensorDoc(null, { event: 'wateringOn', watering: '1', at: '1000' })!;
    const off = mergeLinkTapSensorDoc(on, { event: 'wateringOff', watering: '0', battery: '95', at: '2000' })!;
    expect(off).toMatchObject({ isWatering: false, battery: 95, at: 2000 });
  });

  it('records an alarm code without disturbing watering', () => {
    const on = mergeLinkTapSensorDoc(null, { event: 'wateringOn', watering: '1', at: '1000' })!;
    const alarm = mergeLinkTapSensorDoc(on, { event: 'water cut-off alert', alarm: 'noWater', kind: 'alarm', at: '1500' })!;
    expect(alarm).toMatchObject({ isWatering: true, alarm: 'noWater', event: 'water cut-off alert' });
  });

  it('ignores an empty/absent doc and keeps prior state', () => {
    const prev: LinkTapCloudState = { event: 'wateringOn', at: 1000, isWatering: true };
    expect(mergeLinkTapSensorDoc(prev, null)).toBe(prev);
    expect(mergeLinkTapSensorDoc(prev, undefined)).toBe(prev);
  });

  it('does not regress `at` on an out-of-order/zero timestamp but still applies fields', () => {
    const prev: LinkTapCloudState = { event: 'wateringOn', at: 5000, isWatering: true };
    const s = mergeLinkTapSensorDoc(prev, { event: 'flowMeterValue', flow: '2.1', at: '0' })!;
    expect(s.at).toBe(5000); // zero/invalid at ignored
    expect(s.flow).toBe(2.1);
  });

  it('drops non-numeric flow/battery gracefully', () => {
    const s = mergeLinkTapSensorDoc(null, { event: 'flowMeterValue', flow: 'n/a', at: '1' })!;
    expect(s.flow).toBeUndefined();
  });
});

describe('linkTapSensorStateKey', () => {
  it('prefixes and sanitizes the taplinker id to match the worker', () => {
    expect(linkTapSensorStateKey('3CC1C335004B1200')).toBe('linktap_3CC1C335004B1200');
    expect(linkTapSensorStateKey('a/b#c?d')).toBe('linktap_a_b_c_d');
    expect(linkTapSensorStateKey('')).toBe('linktap_unknown');
  });
});
