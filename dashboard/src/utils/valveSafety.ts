// Pure decision logic for the LinkTap valve's local safety guards.
//
// Extracted from LinkTapWidget so the safety-critical rules can be unit-tested without rendering
// the whole widget (see AGENTS.md rule 3). The valve's real safety net is the volume/duration
// open-limit on the hardware; these guards close it *sooner* than that limit.

export interface SafetyGuardInputs {
  autoGuardEnabled: boolean;
  isBroken: boolean;
  isLeak: boolean;
  isWatering: boolean;
  /** Flow rate in the user's display unit (already converted from raw speed). */
  displaySpeed: number;
  /** User-configured max flow rate in the same display unit. Always > 0 (defaulted upstream). */
  maxFlowRate: number;
  /** Display unit label, only used to build the human-readable cause string. */
  speedUnit: string;
}

export interface SafetyGuardDecision {
  /** True when the valve should be auto-closed now. */
  shutOff: boolean;
  /** Human-readable reason (empty when nothing tripped). */
  cause: string;
}

/**
 * Evaluate the Auto-Guard / Safety Sentry.
 *
 * A broken-pipe alarm, a leak alarm, OR flow exceeding the configured max rate all trip the guard;
 * the valve is only actually shut off when it is currently watering. Previously the excess-flow
 * branch set `cause` but never armed the trip, so `lt_maxflow` did nothing.
 */
export function evaluateSafetyGuard(i: SafetyGuardInputs): SafetyGuardDecision {
  if (!i.autoGuardEnabled) return { shutOff: false, cause: '' };

  let triggered = false;
  let cause = '';

  if (i.isBroken) {
    triggered = true;
    cause = 'Gateway reported a broken pipe alarm!';
  } else if (i.isLeak) {
    triggered = true;
    cause = 'Gateway reported a leak alarm!';
  } else if (i.maxFlowRate > 0 && i.displaySpeed > i.maxFlowRate) {
    triggered = true;
    cause = `Flow rate (${i.displaySpeed.toFixed(1)} ${i.speedUnit}) exceeded safety limit of ${i.maxFlowRate} ${i.speedUnit}!`;
  }

  return { shutOff: triggered && i.isWatering, cause };
}

/**
 * Software-enforced volume cutoff. LinkTap hardware sometimes ignores the volume limit passed to
 * the open command, so the app re-checks it on every poll. Callers MUST pass the *current* target
 * volume (e.g. `stateRef.current.targetVolume`), not a value captured in a render closure — a limit
 * discovered mid-cycle updates the ref, and a stale closure would skip the cutoff.
 */
export function shouldEnforceVolumeCutoff(
  isWatering: boolean,
  targetVolume: number,
  currentVolume: number,
): boolean {
  return isWatering && targetVolume > 0 && currentVolume > 0 && currentVolume >= targetVolume;
}
