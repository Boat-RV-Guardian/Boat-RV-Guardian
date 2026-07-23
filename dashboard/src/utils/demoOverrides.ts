// Transient telemetry overrides for the event simulator (see demoEvents.ts / DemoEventBar.tsx).
//
// The demo generators (demoTelemetry.ts) are pure functions of time. To "simulate an event" — force a
// flood, a dead battery, a shore-power drop — the simulator pins a partial sensorState doc onto a
// device for a short TTL. The demo seams (ShellyWidget, useShellyStatus, useLinkTapCloudState) merge
// any active override on top of the generated doc, so the tile flips to the simulated state and then
// heals back to the animated baseline when the override expires.
//
// Stored in sessionStorage so overrides survive the animation ticks but never leak past the tab (and
// never touch the synced vehicle config). A `demo_sim` event lets listeners react immediately instead
// of waiting for their next poll tick.

const KEY = 'demo_overrides';
export const DEMO_SIM_EVENT = 'demo_sim';

interface Override { doc: Record<string, string>; until: number }
type Store = Record<string, Override>;

function read(): Store {
  try { return JSON.parse(sessionStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

function write(store: Store): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(store)); } catch { /* session full — simulator only */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(DEMO_SIM_EVENT));
}

/** Pin `doc` onto `deviceId` for `ttlMs`. Pass ttlMs=0 for a sticky override (until cleared). */
export function setDemoOverride(deviceId: string, doc: Record<string, string>, ttlMs = 25_000, now = Date.now()): void {
  const store = read();
  store[deviceId] = { doc, until: ttlMs > 0 ? now + ttlMs : Number.MAX_SAFE_INTEGER };
  write(store);
}

/** The active override doc for `deviceId`, or null if none / expired. Prunes expired entries lazily. */
export function getDemoOverride(deviceId: string, now = Date.now()): Record<string, string> | null {
  const store = read();
  const ov = store[deviceId];
  if (!ov) return null;
  if (ov.until <= now) { delete store[deviceId]; write(store); return null; }
  return ov.doc;
}

/** True if any override is currently active. */
export function hasActiveOverrides(now = Date.now()): boolean {
  const store = read();
  return Object.values(store).some((ov) => ov.until > now);
}

/** Drop every override and notify listeners. */
export function clearDemoOverrides(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(DEMO_SIM_EVENT));
}

/**
 * Merge an override doc over a generated base doc. Override fields win; the base carries whatever the
 * override doesn't set (timestamps, battery, signal…). Pure — the seams call this each tick.
 */
export function mergeDemoDoc(base: Record<string, string>, override: Record<string, string> | null): Record<string, string> {
  if (!override) return base;
  return { ...base, ...override };
}
