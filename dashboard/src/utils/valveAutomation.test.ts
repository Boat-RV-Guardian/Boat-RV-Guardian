import { describe, it, expect } from 'vitest';
import { normalRunCommand, commandLockMs, autoRestartDecision, washdownTick } from './valveAutomation';

describe('normalRunCommand', () => {
  it('passes metric volume through unchanged', () => {
    const r = normalRunCommand({ normalRunDaily: false, normalRunHours: 2, normalRunMinutes: 30, normalRunVolume: 300, unitSystem: 'metric' });
    expect(r.durationMins).toBe(150);
    expect(r.volumeLiters).toBe(300);
  });

  it('converts imperial gallons to liters for the API', () => {
    const r = normalRunCommand({ normalRunDaily: false, normalRunHours: 0, normalRunMinutes: 45, normalRunVolume: 100, unitSystem: 'imperial' });
    expect(r.durationMins).toBe(45);
    expect(r.volumeLiters).toBeCloseTo(100 / 0.264172, 5);
  });

  it('daily mode always uses 1439 minutes regardless of h/m', () => {
    const r = normalRunCommand({ normalRunDaily: true, normalRunHours: 5, normalRunMinutes: 10, normalRunVolume: 50, unitSystem: 'metric' });
    expect(r.durationMins).toBe(1439);
  });
});

describe('commandLockMs', () => {
  it('floors at 30s for fast poll intervals (RF actuation lag)', () => {
    expect(commandLockMs(5)).toBe(30000);
  });
  it('uses interval + 5s slack when slower than the floor', () => {
    expect(commandLockMs(31)).toBe(36000);
  });
});

describe('autoRestartDecision', () => {
  const base = {
    wasWatering: true,
    isWatering: false,
    autoRestartEnabled: true,
    autoRestartAvailable: true,
    lastRemainDuration: 10,
    effectiveIntervalSecs: 5,
    manualStopTriggered: false,
  };

  it('restarts on a natural timer expiration', () => {
    expect(autoRestartDecision(base)).toBe('restart');
  });

  it('does nothing when not a watering→stopped transition', () => {
    expect(autoRestartDecision({ ...base, wasWatering: false })).toBe('none');
    expect(autoRestartDecision({ ...base, isWatering: true })).toBe('none');
  });

  it('does nothing when the loop is disabled or unavailable (paid plan)', () => {
    expect(autoRestartDecision({ ...base, autoRestartEnabled: false })).toBe('none');
    expect(autoRestartDecision({ ...base, autoRestartAvailable: false })).toBe('none');
  });

  it('skips when the valve closed mid-cycle (flood shutoff / external close)', () => {
    // remaining duration far above one poll interval → not a natural expiration
    expect(autoRestartDecision({ ...base, lastRemainDuration: 3600 })).toBe('skip-manual-stop');
  });

  it('skips when a manual stop was commanded', () => {
    expect(autoRestartDecision({ ...base, manualStopTriggered: true })).toBe('skip-manual-stop');
  });

  it('treats remain within interval + 15s slack as natural', () => {
    expect(autoRestartDecision({ ...base, lastRemainDuration: 20, effectiveIntervalSecs: 5 })).toBe('restart');
    expect(autoRestartDecision({ ...base, lastRemainDuration: 21, effectiveIntervalSecs: 5 })).toBe('skip-manual-stop');
  });
});

describe('washdownTick', () => {
  it('idle when no washdown transition is armed', () => {
    expect(washdownTick(null, 1000)).toEqual({ phase: 'idle' });
  });

  it('reports the exact washdown remainder while running', () => {
    expect(washdownTick(61_000, 1000)).toEqual({ phase: 'running', remainSecs: 60 });
  });

  it('expires when the washdown window elapses', () => {
    expect(washdownTick(1000, 1000)).toEqual({ phase: 'expired' });
    expect(washdownTick(1000, 5000)).toEqual({ phase: 'expired' });
  });
});
