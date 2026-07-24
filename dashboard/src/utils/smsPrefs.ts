// Per-vehicle SMS/voice alert preferences (open-tasks Task 6/14). Decided storage model: prefs are a
// SYNCED PER-VEHICLE config field (`sh_sms_prefs`, JSON-as-string in VEHICLE_DEFAULT_CONFIG) — this
// matches the per-vehicle `tier` entitlement and the worker's `SmsPrefs` shape (in brvg-cloud-server),
// so the worker can read the same numbers/events off the vehicle doc when a provider is wired. (The
// account portal hosts the UI per Task 14; the data is per-vehicle because the entitlement is.)
//
// Pure + synchronous so it's unit-testable. SMS is a Premium entitlement (`canSmsAlert`); gating
// lives at the call sites (UI + worker), not here.

export interface SmsPrefs {
  /** Destination phone numbers, normalized to E.164-ish (see normalizePhone). */
  phones: string[];
  /** Event keys opted into SMS escalation (subset of SMS_EVENT_CATALOG keys). */
  events: string[];
}

export const EMPTY_SMS_PREFS: SmsPrefs = { phones: [], events: [] };

export interface SmsEvent {
  key: string;
  label: string;
}

/** The alerts a user can escalate to SMS — mirrors the per-event push toggles in NotificationsPanel. */
export const SMS_EVENT_CATALOG: readonly SmsEvent[] = [
  { key: 'flood', label: 'Flood / leak detected' },
  { key: 'low_battery', label: 'Low battery' },
  { key: 'shore_power', label: 'Shore power lost' },
  { key: 'offline', label: 'Device went offline' },
];

/** Parse the `sh_sms_prefs` JSON string, tolerating empty/corrupt input. De-dupes + trims. */
export function parseSmsPrefs(raw: string | null | undefined): SmsPrefs {
  if (!raw) return { phones: [], events: [] };
  try {
    const o = JSON.parse(raw) as { phones?: unknown; events?: unknown };
    const phones: string[] = Array.isArray(o.phones)
      ? o.phones.map((p) => String(p).trim()).filter((s): s is string => s.length > 0) : [];
    const events: string[] = Array.isArray(o.events)
      ? o.events.map((e) => String(e)).filter((s): s is string => s.length > 0) : [];
    return { phones: [...new Set(phones)], events: [...new Set(events)] };
  } catch {
    return { phones: [], events: [] };
  }
}

export function serializeSmsPrefs(prefs: SmsPrefs): string {
  return JSON.stringify({ phones: prefs.phones, events: prefs.events });
}

/**
 * Normalize a user-entered phone number to E.164-ish: an optional leading `+` then 7–15 digits
 * (all other characters — spaces, dashes, parens — are stripped). Returns null when it can't be a
 * valid number, so the UI can show an error instead of storing junk.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = String(input).trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return (hasPlus ? '+' : '') + digits;
}

/** Add a normalized phone (no-op on invalid or duplicate). */
export function addPhone(prefs: SmsPrefs, input: string): SmsPrefs {
  const norm = normalizePhone(input);
  if (!norm || prefs.phones.includes(norm)) return prefs;
  return { ...prefs, phones: [...prefs.phones, norm] };
}

export function removePhone(prefs: SmsPrefs, phone: string): SmsPrefs {
  if (!prefs.phones.includes(phone)) return prefs;
  return { ...prefs, phones: prefs.phones.filter((p) => p !== phone) };
}

/**
 * Add a freeform destination "handle" (no phone normalization) — for channels like Telegram whose
 * destination is a chat id or `@username`, not an E.164 number. Trims; no-op on empty/duplicate.
 * The `phones` array is reused as the generic address list (the cloud-server maps it to `addresses`).
 */
export function addHandle(prefs: SmsPrefs, input: string): SmsPrefs {
  const h = String(input).trim();
  if (!h || prefs.phones.includes(h)) return prefs;
  return { ...prefs, phones: [...prefs.phones, h] };
}

/** Normalize a user-entered email: trim + lowercase; returns null when it isn't a plausible address. */
export function normalizeEmail(input: string): string | null {
  const e = String(input).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** Add a validated email (no-op on invalid or duplicate). Reuses the generic `phones` address list. */
export function addEmail(prefs: SmsPrefs, input: string): SmsPrefs {
  const norm = normalizeEmail(input);
  if (!norm || prefs.phones.includes(norm)) return prefs;
  return { ...prefs, phones: [...prefs.phones, norm] };
}

/** Opt an event in/out of SMS escalation. */
export function setEventEnabled(prefs: SmsPrefs, event: string, on: boolean): SmsPrefs {
  const has = prefs.events.includes(event);
  if (on && !has) return { ...prefs, events: [...prefs.events, event] };
  if (!on && has) return { ...prefs, events: prefs.events.filter((e) => e !== event) };
  return prefs;
}
