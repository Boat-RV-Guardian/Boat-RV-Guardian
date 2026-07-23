// Local rolling history of sensor readings, recorded while the app is open, to draw the Dashboard
// sparklines. This is a display cache, not the durable history feature (see CLAUDE.md — LinkTap
// usage history / cloud rollups are separate): points are per-device, capped, pruned to a 48 h
// window, and live in user-scoped localStorage (wiped on identity change like all lt_* keys).

export interface ReadingPoint { t: number; v: number }

export const HISTORY_WINDOW_MS = 48 * 60 * 60 * 1000;
export const MIN_SAMPLE_GAP_MS = 2 * 60 * 1000;
export const MAX_POINTS = 400;

const key = (deviceId: string) => `lt_read_hist_${deviceId}`;

const load = (deviceId: string, storage: Storage): ReadingPoint[] => {
  try {
    const raw = JSON.parse(storage.getItem(key(deviceId)) || 'null');
    if (!Array.isArray(raw)) return [];
    return raw.filter((p: any) => p && Number.isFinite(p.t) && Number.isFinite(p.v));
  } catch { return []; }
};

const prune = (points: ReadingPoint[], now: number): ReadingPoint[] =>
  points.filter((p) => now - p.t <= HISTORY_WINDOW_MS).slice(-MAX_POINTS);

/**
 * Append a reading if the last sample is older than MIN_SAMPLE_GAP_MS (or the value changed).
 * Returns true when a point was written.
 */
export function recordReading(deviceId: string, value: number, now = Date.now(), storage: Storage = localStorage): boolean {
  if (!Number.isFinite(value)) return false;
  const points = prune(load(deviceId, storage), now);
  const last = points[points.length - 1];
  if (last && now - last.t < MIN_SAMPLE_GAP_MS && last.v === value) return false;
  if (last && now - last.t < 15_000) return false; // hard floor: never more than one point / 15 s
  points.push({ t: now, v: value });
  try { storage.setItem(key(deviceId), JSON.stringify(prune(points, now))); } catch { /* quota — display cache only */ }
  return true;
}

/** Pruned, chronological points for a device (empty when none recorded yet). */
export function getReadings(deviceId: string, now = Date.now(), storage: Storage = localStorage): ReadingPoint[] {
  return prune(load(deviceId, storage), now);
}

// --- Sparkline range ------------------------------------------------------------------------------
// How far back the dashboard sparklines look. 48 h is the whole retained buffer (HISTORY_WINDOW_MS),
// so 'all' is the widest meaningful choice. Device-local display preference.

export const RANGE_KEY = 'lt_dash_range';

export interface HistoryRange { key: string; label: string; ms: number }

export const HISTORY_RANGES: HistoryRange[] = [
  { key: '1h', label: '1 h', ms: 60 * 60 * 1000 },
  { key: '6h', label: '6 h', ms: 6 * 60 * 60 * 1000 },
  { key: '24h', label: '24 h', ms: 24 * 60 * 60 * 1000 },
  { key: 'all', label: '48 h', ms: HISTORY_WINDOW_MS },
];

export const DEFAULT_RANGE_KEY = 'all';

export function rangeByKey(key: string | null | undefined): HistoryRange {
  return HISTORY_RANGES.find((r) => r.key === key) ?? HISTORY_RANGES[HISTORY_RANGES.length - 1];
}

export function loadRangeKey(storage: Storage = localStorage): string {
  return rangeByKey(storage.getItem(RANGE_KEY)).key;
}

export function saveRangeKey(key: string, storage: Storage = localStorage): void {
  try { storage.setItem(RANGE_KEY, rangeByKey(key).key); } catch { /* ignore */ }
}

/** Points within `rangeMs` of `now`. Returns the input untouched for a range covering everything. */
export function withinRange(points: ReadingPoint[], rangeMs: number, now = Date.now()): ReadingPoint[] {
  return points.filter((p) => now - p.t <= rangeMs);
}
