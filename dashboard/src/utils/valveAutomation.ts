// Pure decision logic for the LinkTapWidget automations (Task 3 hook-split).
// These rules were previously inlined in the widget's poll closure / button handlers;
// they are extracted verbatim so they can be unit-tested (AGENTS.md rule 3).

export interface NormalRunProfile {
  normalRunDaily: boolean;
  normalRunHours: number;
  normalRunMinutes: number;
  normalRunVolume: number;
  unitSystem: 'metric' | 'imperial';
}

/**
 * The Normal Run start command derived from the configured profile.
 * Volume is converted to liters for the API when the user works in imperial;
 * "Daily" runs use 1439 minutes (24h - 1min, the gateway's max daily cycle).
 */
export function normalRunCommand(p: NormalRunProfile): { durationMins: number; volumeLiters: number } {
  let vol = p.normalRunVolume;
  if (p.unitSystem === 'imperial') vol = vol / 0.264172;
  const durationMins = p.normalRunDaily ? 1439 : (p.normalRunHours * 60) + p.normalRunMinutes;
  return { durationMins, volumeLiters: vol };
}

/**
 * How long the optimistic command lock holds before giving up on the valve
 * reaching the expected state (poll interval + slack, floored at 30s for RF lag).
 */
export function commandLockMs(effectiveIntervalSecs: number): number {
  return Math.max(30000, effectiveIntervalSecs * 1000 + 5000);
}

export interface AutoRestartInput {
  /** was watering on the previous poll */
  wasWatering: boolean;
  /** watering per the current poll */
  isWatering: boolean;
  /** the Auto-Restart (Loop) toggle */
  autoRestartEnabled: boolean;
  /** loop offered only in local-only mode / Free plan */
  autoRestartAvailable: boolean;
  /** remain_duration (secs) from the previous poll */
  lastRemainDuration: number;
  /** poll interval (secs) */
  effectiveIntervalSecs: number;
  /** a manual stop was commanded since the last cycle */
  manualStopTriggered: boolean;
}

export type AutoRestartDecision = 'restart' | 'skip-manual-stop' | 'none';

/**
 * Auto-restart fires only on a watering→stopped transition that looks like a NATURAL
 * timer expiration (remaining duration was within one poll interval + 15s slack).
 * A manual stop — or a stop mid-cycle (e.g. flood shutoff, external close) — must
 * NOT loop the valve back open.
 */
export function autoRestartDecision(i: AutoRestartInput): AutoRestartDecision {
  if (!(i.wasWatering && !i.isWatering && i.autoRestartEnabled && i.autoRestartAvailable)) return 'none';
  const naturalExpiration = i.lastRemainDuration <= (i.effectiveIntervalSecs + 15);
  if (i.manualStopTriggered || !naturalExpiration) return 'skip-manual-stop';
  return 'restart';
}

export type WashdownTick =
  | { phase: 'idle' }
  | { phase: 'running'; remainSecs: number }
  | { phase: 'expired' };

/**
 * Washdown-with-resume runs the valve past the washdown window (hardware duration
 * carries a +5min buffer) and the app reprograms to the Normal Run profile when the
 * window elapses. While running, the UI shows the exact washdown remainder instead
 * of the buffered hardware remainder.
 */
export function washdownTick(transitionTimeMs: number | null, nowMs: number): WashdownTick {
  if (!transitionTimeMs) return { phase: 'idle' };
  const remainingMs = transitionTimeMs - nowMs;
  if (remainingMs <= 0) return { phase: 'expired' };
  return { phase: 'running', remainSecs: Math.round(remainingMs / 1000) };
}
