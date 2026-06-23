// Phase-1 cloud history sync (opt-in behind the `lt_store_history_cloud` toggle).
//
// Data model — one monthly rollup document per device:
//   vehicles/{vid}/history/{deviceId}_{YYYY-MM}
//     {
//       deviceId, month: "2026-06",
//       usage:  { "<UTC ISO hour>": liters },   // mirrors lt_usage_history_<deviceId>
//       events: { "<epoch ms>": { type, message } },  // mirrors the Event Sentry Log
//       allowedUsers: [uid],                     // same ownership pattern as the vehicle doc
//       updatedAt: <epoch>
//     }
//
// `usage` and `events` are MAPS so `setDoc(..., {merge:true})` deep-merges new keys without
// clobbering existing ones — no read-before-write needed. All timestamps are UTC (see utils/time).
import { db, auth, doc, getDoc, setDoc } from '../services/firebase';
import { arrayUnion } from 'firebase/firestore';

export interface HistoryEvent { ts: number; type: string; message: string; }

const monthOf = (d: Date): string => d.toISOString().slice(0, 7); // "YYYY-MM" in UTC
const histDocId = (deviceId: string, month: string) => `${deviceId.replace(/\//g, '_')}_${month}`;

/** The current and previous UTC months — the window we actively write and read (≥30 days). */
export function recentMonthsUTC(): string[] {
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return [monthOf(prev), monthOf(now)];
}

/**
 * Push usage buckets + events to their monthly rollup docs. Callers should pass only recent-month
 * data (older months are immutable) so each push writes at most ~2 documents.
 */
export async function pushDeviceHistory(
  vid: string,
  deviceId: string,
  usage: Record<string, number>,
  events: HistoryEvent[],
): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid || !vid || !deviceId) return;

  const byMonth: Record<string, { usage: Record<string, number>; events: Record<string, any> }> = {};
  const ensure = (m: string) => (byMonth[m] ||= { usage: {}, events: {} });

  for (const [iso, liters] of Object.entries(usage)) {
    const m = iso.slice(0, 7);
    if (m.length === 7) ensure(m).usage[iso] = liters;
  }
  for (const ev of events) {
    // Guard against NaN/Infinity too (both are typeof 'number') — an invalid ts would otherwise
    // throw RangeError in new Date(ts).toISOString() and abort the entire push, dropping usage.
    if (!Number.isFinite(ev?.ts)) continue;
    ensure(monthOf(new Date(ev.ts))).events[String(ev.ts)] = { type: ev.type, message: ev.message };
  }

  await Promise.all(
    Object.entries(byMonth).map(([month, data]) => {
      const ref = doc(db, 'vehicles', vid, 'history', histDocId(deviceId, month));
      return setDoc(
        ref,
        { deviceId, month, usage: data.usage, events: data.events, allowedUsers: arrayUnion(uid), updatedAt: Date.now() },
        { merge: true },
      );
    }),
  );
}

/** Read the current + previous month docs and return merged usage buckets and events. */
export async function fetchDeviceHistory(
  vid: string,
  deviceId: string,
): Promise<{ usage: Record<string, number>; events: HistoryEvent[] }> {
  const out = { usage: {} as Record<string, number>, events: [] as HistoryEvent[] };
  if (!auth.currentUser?.uid || !vid || !deviceId) return out;

  for (const month of recentMonthsUTC()) {
    try {
      const snap = await getDoc(doc(db, 'vehicles', vid, 'history', histDocId(deviceId, month)));
      if (!snap.exists()) continue;
      const data = snap.data() as any;
      if (data.usage) {
        for (const [iso, liters] of Object.entries(data.usage)) {
          out.usage[iso] = Math.max(out.usage[iso] || 0, Number(liters) || 0);
        }
      }
      if (data.events) {
        for (const [ts, ev] of Object.entries<any>(data.events)) {
          out.events.push({ ts: Number(ts), type: ev?.type || 'info', message: ev?.message || '' });
        }
      }
    } catch {
      /* ignore a single month's read failure (offline / not-yet-created) */
    }
  }
  return out;
}
