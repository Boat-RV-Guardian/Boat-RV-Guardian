import { describe, it, expect } from 'vitest';
import { evaluateSafetyGuard, shouldEnforceVolumeCutoff, type SafetyGuardInputs } from './valveSafety';

const base: SafetyGuardInputs = {
  autoGuardEnabled: true,
  isBroken: false,
  isLeak: false,
  isWatering: true,
  displaySpeed: 5,
  maxFlowRate: 15,
  speedUnit: 'L/min',
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

  // Regression: the excess-flow branch used to set `cause` but never armed the trip, so the
  // configured max flow rate did nothing. This asserts the shutoff now actually fires.
  it('trips when flow exceeds the max flow rate (was dead code)', () => {
    const d = evaluateSafetyGuard({ ...base, displaySpeed: 20, maxFlowRate: 15 });
    expect(d.shutOff).toBe(true);
    expect(d.cause).toContain('exceeded safety limit');
  });

  it('does NOT trip on normal flow under the limit', () => {
    expect(evaluateSafetyGuard({ ...base, displaySpeed: 5, maxFlowRate: 15 }).shutOff).toBe(false);
  });

  it('reports the cause but does not shut off when not watering', () => {
    const d = evaluateSafetyGuard({ ...base, displaySpeed: 20, maxFlowRate: 15, isWatering: false });
    expect(d.shutOff).toBe(false);
    expect(d.cause).toContain('exceeded safety limit');
  });

  it('never trips on flow when maxFlowRate is 0 (guard against shutting off all watering)', () => {
    expect(evaluateSafetyGuard({ ...base, displaySpeed: 5, maxFlowRate: 0 }).shutOff).toBe(false);
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
