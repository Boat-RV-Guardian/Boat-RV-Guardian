// Editable display name (open-tasks Task 14 — "Account basics: editing display name"). The validation
// + save orchestration are pure and dependency-injected so they're fully unit-testable without
// Firebase; the EditDisplayName component supplies the real Auth/Firestore ops (lazy-imported in its
// handler) so Account.tsx stays Firebase-light.

export const MAX_DISPLAY_NAME = 60;

export interface DisplayNameCheck {
  /** The normalized candidate (trimmed, internal whitespace collapsed to single spaces). */
  value: string;
  /** Non-empty and within the length budget. */
  valid: boolean;
  /** Differs from the current name (after the same normalization). */
  changed: boolean;
  /** Why it's not valid (only when `valid` is false). */
  error?: string;
}

/**
 * Normalize + validate a candidate display name against the current one. Save should be offered only
 * when `valid && changed`. Pure.
 */
export function checkDisplayName(raw: string, current?: string | null): DisplayNameCheck {
  const value = (raw ?? '').trim().replace(/\s+/g, ' ');
  const cur = (current ?? '').trim().replace(/\s+/g, ' ');
  const changed = value !== cur;
  if (!value) return { value, valid: false, changed, error: 'Display name cannot be empty.' };
  if (value.length > MAX_DISPLAY_NAME) {
    return { value, valid: false, changed, error: `Display name must be ${MAX_DISPLAY_NAME} characters or fewer.` };
  }
  return { value, valid: true, changed };
}

export interface DisplayNameDeps {
  /** Update the Firebase Auth profile's displayName (the source of truth for the name). */
  updateAuthProfile: (displayName: string) => Promise<void>;
  /** Mirror the name into the `users/{uid}` registry doc (best-effort — drives the admin Users tab). */
  updateUserDoc: (displayName: string) => Promise<void>;
}

export interface SaveDisplayNameResult {
  ok: boolean;
  error?: string;
}

/**
 * Persist a (pre-validated, normalized) display name: update the Auth profile first (authoritative);
 * mirror to the registry doc best-effort (a failure there is non-fatal — the name still changed).
 * Orchestration only; deps do the I/O. Pure aside from the injected effects.
 */
export async function saveDisplayName(value: string, deps: DisplayNameDeps): Promise<SaveDisplayNameResult> {
  try {
    await deps.updateAuthProfile(value);
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
  try { await deps.updateUserDoc(value); } catch { /* registry mirror is best-effort */ }
  return { ok: true };
}
