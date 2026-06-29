// Aggregation for the Alerts destination (Task 16 IA). Each device keeps its own Event Sentry Log in
// localStorage (`lt_event_log_<deviceId>`, an AlertLog[] capped at 50). Alerts merges those per-device
// logs into one vehicle-scoped timeline and derives a "current issues" summary. Pure + dependency-
// injected (the reader is supplied) so it's fully testable without localStorage.

import type { AlertLog } from '../hooks/useDeviceHistory';

export interface AlertDevice {
  id: string;
  name?: string;
}

export interface AlertEvent extends AlertLog {
  deviceId: string;
  deviceName: string;
}

/** How many merged events to keep (each device log is already capped at 50). */
export const MAX_MERGED_EVENTS = 200;

/** "Needs attention" lookback window (ms) for currentIssues. */
export const ISSUE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Merge every device's Event Sentry Log into one timeline, newest first. `read` returns a device's
 * AlertLog[] (the component passes a localStorage reader). Entries with a non-finite ts are dropped
 * (defensive — mirrors the historySync NaN guard). Capped at MAX_MERGED_EVENTS. Pure.
 */
export function mergeDeviceLogs(devices: AlertDevice[], read: (deviceId: string) => AlertLog[]): AlertEvent[] {
  const out: AlertEvent[] = [];
  for (const d of devices) {
    const logs = read(d.id) || [];
    for (const l of logs) {
      if (!l || !Number.isFinite(l.ts)) continue;
      out.push({ ts: l.ts, type: l.type, message: l.message, deviceId: d.id, deviceName: d.name || d.id });
    }
  }
  out.sort((a, b) => b.ts - a.ts);
  return out.slice(0, MAX_MERGED_EVENTS);
}

/**
 * Derive the "current issues" summary from a merged timeline: the most recent danger/warning event
 * PER DEVICE within the lookback window (a device's later non-alert event clears it — i.e. if the
 * device's newest event in-window isn't a danger/warning, it has no current issue). Newest first. Pure.
 */
export function currentIssues(events: AlertEvent[], nowMs: number, withinMs: number = ISSUE_WINDOW_MS): AlertEvent[] {
  const seen = new Set<string>();
  const issues: AlertEvent[] = [];
  for (const e of events) { // events are already newest-first
    if (nowMs - e.ts > withinMs) continue;
    if (seen.has(e.deviceId)) continue; // only the newest in-window event per device decides its state
    seen.add(e.deviceId);
    if (e.type === 'danger' || e.type === 'warning') issues.push(e);
  }
  return issues;
}
