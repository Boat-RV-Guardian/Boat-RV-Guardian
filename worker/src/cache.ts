/**
 * Pure TTL / expiry helpers for the worker's in-isolate caches (open-tasks Task 8 cost levers,
 * COST_ANALYSIS §5).
 *
 * Cloudflare Worker isolates are reused across many requests, so caching the OAuth access token and
 * the vehicle config doc in module scope cuts the dominant per-telemetry cost: WITHOUT this, every
 * webhook mints a fresh Firebase OAuth token (a full RS256 JWT sign + a token-endpoint round-trip)
 * AND re-reads the vehicle doc from Firestore — on a 60s telemetry cadence that's ~2,900 of each per
 * vehicle per day, all redundant. These helpers are pure so the expiry logic is unit-tested without a
 * live isolate; the mutable caches themselves live in index.ts.
 *
 * Safety note: the flood/shutoff path deliberately BYPASSES the vehicle-doc cache (see index.ts) so a
 * real alarm always acts on fresh LinkTap credentials — the cache only accelerates the common
 * telemetry/read path, never the safety chain.
 */

/** A value cached at `at` (epoch ms). */
export interface Cached<T> {
  value: T;
  at: number;
}

/**
 * True if a cache entry stamped at `at` is still within its `ttlMs` window as of `nowMs`.
 * Missing / non-finite timestamps are treated as stale (fail safe → re-fetch).
 */
export function isCacheFresh(at: number | null | undefined, nowMs: number, ttlMs: number): boolean {
  if (at == null || !Number.isFinite(at) || !Number.isFinite(nowMs)) return false;
  return nowMs - at < ttlMs;
}

/**
 * True if an OAuth access token is still usable, keeping `skewMs` of headroom before its hard
 * expiry so a token never expires mid-flight. Missing / non-finite expiries are treated as expired.
 */
export function tokenValid(expiresAtMs: number | null | undefined, nowMs: number, skewMs = 60_000): boolean {
  if (expiresAtMs == null || !Number.isFinite(expiresAtMs) || !Number.isFinite(nowMs)) return false;
  return expiresAtMs - nowMs > skewMs;
}

/**
 * Compute the absolute expiry (epoch ms) for an OAuth token given the `expires_in` seconds the token
 * endpoint returned. Defensive against a missing/garbage value → treats it as already expired (0) so
 * the caller re-mints rather than trusting a bogus long-lived token.
 */
export function tokenExpiryMs(nowMs: number, expiresInSec: unknown): number {
  const secs = Number(expiresInSec);
  if (!Number.isFinite(secs) || secs <= 0) return 0;
  return nowMs + secs * 1000;
}
