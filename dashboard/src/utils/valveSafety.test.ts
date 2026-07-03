import { describe, it, expect } from 'vitest';
import { evaluateSafetyGuard, shouldEnforceVolumeCutoff, type SafetyGuardInputs } from './valveSafety';

const base: SafetyGuardInputs = {
  autoGuardEnabled: true,
  isBroken: false,
  isLeak: false,
  isWatering: true,
};

describe('evaluateSafetyGuard', () => {
  it('does nothing when the guard is disabled', () => {
    expect(evaluateSafetyGuard({ ...base, autoGuardEnabled: false, isBroken: true })).toEqual({
      shutOff: false,
      cause: '',
    });
  });

  it('trips on a broken-pipe alarm while watering', () => {
    const d = evaluateSafetyGuard({ ...base, isBroken: true });
    expect(d.shutOff).toBe(true);
    expect(d.cause).toMatch(/broken pipe/i);
  });

  it('trips on a leak alarm while watering', () => {
    const d = evaluateSafetyGuard({ ...base, isLeak: true });
    expect(d.shutOff).toBe(true);
    expect(d.cause).toMatch(/leak/i);
  });

  // A boat's valve legitimately runs wide open, so there is NO flow-rate trip — high flow alone
  // must never close the valve.
  it('never trips on high flow (flow-rate shutoff removed)', () => {
    expect(evaluateSafetyGuard({ ...base }).shutOff).toBe(false);
  });

  it('reports no cause and does not shut off when watering with no alarm', () => {
    const d = evaluateSafetyGuard({ ...base });
    expect(d.shutOff).toBe(false);
    expect(d.cause).toBe('');
  });

  it('does not shut off on an alarm when not watering', () => {
    expect(evaluateSafetyGuard({ ...base, isBroken: true, isWatering: false }).shutOff).toBe(false);
  });
});

describe('shouldEnforceVolumeCutoff', () => {
  it('cuts off once the current volume reaches the target', () => {
    expect(shouldEnforceVolumeCutoff(true, 10, 10)).toBe(true);
    expect(shouldEnforceVolumeCutoff(true, 10, 12)).toBe(true);
  });

  it('does not cut off below the target', () => {
    expect(shouldEnforceVolumeCutoff(true, 10, 9)).toBe(false);
  });

  it('is inert when not watering, when no target is set, or before any volume is seen', () => {
    expect(shouldEnforceVolumeCutoff(false, 10, 10)).toBe(false);
    expect(shouldEnforceVolumeCutoff(true, 0, 10)).toBe(false);
    expect(shouldEnforceVolumeCutoff(true, 10, 0)).toBe(false);
  });
});
