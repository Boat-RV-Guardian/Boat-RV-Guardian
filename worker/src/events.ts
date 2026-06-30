/**
 * Pure, transport-agnostic webhook event classification + param extraction.
 *
 * Extracted from index.ts so the same logic runs on the Cloudflare Worker today and on the
 * self-hostable Node/Docker adapter later (see open-tasks.md Task 7), and so it can be unit-tested
 * without standing up Firestore/FCM (Task 2). Everything here is a pure function — no I/O.
 */

/**
 * Events that should trigger an automatic water shutoff (flood/leak/alarm). Shelly devices report
 * their real event names via Webhook.ListSupported, so we match by family rather than hardcoding.
 */
export const FLOOD_EVENT_RE = /flood|leak|alarm/i;

/**
 * Periodic telemetry (e.g. `voltmeter.measurement` every 60s, `*.change`). These are cached for
 * remote display but must NEVER push (would notify every minute) and must NEVER trigger a shutoff.
 */
export const TELEMETRY_EVENT_RE = /\.(measurement|change)$/i;

/**
 * "Cleared"/"dried out" variants of an alarm — e.g. `flood.alarm_off`. These also match
 * FLOOD_EVENT_RE (they contain "flood"/"alarm"), so without this guard the dry-out event fires a
 * redundant valve close. Closing is idempotent so it was harmless, but it's noise and could mask a
 * genuine re-trigger; treat `*_off` / `*.off` as NOT a flood trigger.
 */
export const ALARM_CLEARED_RE = /(?:_off|\.off)$/i;

/** True for periodic telemetry that should be cached but never pushed/triggered. */
export function isTelemetry(event: string): boolean {
  return TELEMETRY_EVENT_RE.test(event);
}

/** True for the "cleared/off" variant of an alarm (e.g. flood.alarm_off). */
export function isAlarmCleared(event: string): boolean {
  return ALARM_CLEARED_RE.test(event);
}

/**
 * True only for a *real* flood/leak alarm that should close the valve: matches the flood family,
 * is not the cleared/off variant, and is not periodic telemetry.
 */
export function isFloodShutoff(event: string): boolean {
  return FLOOD_EVENT_RE.test(event) && !isAlarmCleared(event) && !isTelemetry(event);
}

/**
 * Map a raw Shelly webhook event to the semantic SMS opt-in key the user toggles in the account
 * portal (mirrors SMS_EVENT_CATALOG in dashboard/src/utils/smsPrefs.ts: flood / low_battery /
 * shore_power / offline). Returns null for telemetry and anything not SMS-eligible. Best-effort
 * pattern match — device event names vary, so this is conservative; tune against real device events
 * as they're observed. Pure.
 */
export function smsEventKey(event: string): string | null {
  if (!event || isTelemetry(event)) return null;
  if (isFloodShutoff(event)) return 'flood';
  const e = event.toLowerCase();
  if (/(?:low|crit)[._ ]*batt|batt[a-z]*[._ ]*(?:low|crit)|low_?battery/.test(e)) return 'low_battery';
  if (/shore|mains[._ ]*(?:lost|off|fail)|power[._ ]*(?:lost|fail|out|off)/.test(e)) return 'shore_power';
  if (/offline|disconnect|unreachable/.test(e)) return 'offline';
  return null;
}

/** Query params that are routing/identity/auth, not sensor telemetry to cache. */
export const RESERVED_PARAMS: ReadonlySet<string> = new Set(['vid', 'event', 'device', 'key']);

/**
 * Extract the telemetry params a device embedded in its webhook URL (e.g. `?v=<calibrated volts>`
 * `&vraw=<raw>&tC=<temp>`) into a plain map, skipping routing params and unset placeholders.
 * Returns plain string values; the caller value-wraps them for Firestore.
 */
export function extractSensorStateExtras(searchParams: Iterable<[string, string]>): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const [k, val] of searchParams) {
    if (RESERVED_PARAMS.has(k)) continue;
    if (val === '' || val === 'null') continue; // skip unset placeholders
    extra[k] = val;
  }
  return extra;
}

/** Sanitize a device id for use as a Firestore document id (no path-significant chars). */
export function sanitizeDevice(device: string | null | undefined): string {
  return (device || 'unknown').replace(/[\/#?]/g, '_');
}

// — Tier-aware telemetry persistence throttle (open-tasks Task 6 / cost lever, COST_ANALYSIS §5) —
//
// Telemetry (voltmeter etc.) pushes ~every 60s and is the dominant write cost. Lower tiers persist
// LESS often: the worker keeps the freshest event but only WRITES the cached sensorState every
// `telemetryResolutionSec`. This both controls cost AND is the per-tier "remote view freshness"
// feature. ONLY telemetry is throttled — flood/alarm events and the shutoff path are never affected.
//
// NOTE: these resolution numbers mirror TIER_FEATURES in dashboard/src/utils/entitlements.ts. They're
// duplicated here only until the shared self-host core lands (Task 7); keep them in sync.
export const TELEMETRY_RESOLUTION_SEC: Record<'free' | 'basic' | 'premium', number> = {
  free: 1800, // ~30 min
  basic: 300, // ~5 min
  premium: 60, // ~1 min
};

/**
 * Persistence cadence for a vehicle's tier. Unknown/legacy tiers map to the premium cadence (60s) so
 * the worker's behavior is unchanged for grandfathered vehicles (which persist on every push today).
 */
export function telemetryResolutionSecForTier(tier: string | null | undefined): number {
  if (tier === 'free' || tier === 'basic' || tier === 'premium') return TELEMETRY_RESOLUTION_SEC[tier];
  return TELEMETRY_RESOLUTION_SEC.premium;
}

/**
 * Should this telemetry sample be persisted now, given when we last persisted? True if there's no
 * prior write, the timestamps are unusable, or at least `resolutionSec` has elapsed. Pure.
 */
export function shouldPersistTelemetry(nowMs: number, lastAtMs: number | null | undefined, resolutionSec: number): boolean {
  if (lastAtMs == null || !Number.isFinite(lastAtMs) || !Number.isFinite(nowMs)) return true;
  return nowMs - lastAtMs >= resolutionSec * 1000;
}

// Liveness payload for GET /api/health (open-tasks Task 12 Operations tab). Pure + cheap: no
// secrets, no Firestore — just confirms the worker is up so the (cross-origin) admin console can
// ping it. Served with CORS in index.ts.
export const WORKER_SERVICE = 'boat-rv-guardian-webhooks';

export function healthBody(nowMs: number): { ok: true; service: string; time: number } {
  return { ok: true, service: WORKER_SERVICE, time: nowMs };
}

// — Send-status persistence (open-tasks.md §6 "Still server-backed-only: FCM/SMS send-success
// status") — the webhook computes FCM/SMS dispatch results for alert events but historically only
// returned them in the HTTP response, leaving no durable/queryable record. `lastSend` is a small
// map field merged onto the same `vehicles/{vid}/sensorState/{device}` doc the webhook already
// writes, via a masked PATCH (see patchFirestoreFields in index.ts) so it never clobbers — or gets
// clobbered by — the `event`/`at`/telemetry-extras write that happens earlier in the same request.

/** Inputs needed to build the `lastSend` Firestore field-value for an alert event. */
export interface LastSendInput {
  event: string;
  at: number;
  fcmSent: number;
  fcmFailed: number;
  smsAttempted: number;
  smsSent: number;
}

/**
 * Build the Firestore (REST, value-wrapped) `mapValue` for a `lastSend` field summarizing the
 * FCM/SMS dispatch outcome of one alert webhook. Pure — no I/O. The caller PATCHes this onto
 * `vehicles/{vid}/sensorState/{device}` with `maskPaths: ['lastSend']` so it's a precise merge.
 */
export function buildLastSendField(input: LastSendInput): { mapValue: { fields: Record<string, { stringValue: string } | { integerValue: string }> } } {
  return {
    mapValue: {
      fields: {
        event: { stringValue: input.event },
        at: { integerValue: String(input.at) },
        fcmSent: { integerValue: String(input.fcmSent) },
        fcmFailed: { integerValue: String(input.fcmFailed) },
        smsAttempted: { integerValue: String(input.smsAttempted) },
        smsSent: { integerValue: String(input.smsSent) },
      },
    },
  };
}
