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
 * A broken-pipe alarm or a leak alarm trips the guard; the valve is only actually shut off when it
 * is currently watering. There is deliberately NO flow-rate ("max flow") trip: on a boat the valve
 * legitimately runs wide open (washdown, tank fill), so a flow-rate cap only produced spurious
 * shutoffs. The valve's real safety net is the hardware volume/duration open-limit.
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
