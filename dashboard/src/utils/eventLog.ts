// Shared writer for a device's Event Sentry Log (localStorage `lt_event_log_<deviceId>`, an
// AlertLog[] capped at 50, newest-first). Alerts.tsx + the dashboard's activity feed read these.
// Extracted so the demo scenario driver and the event simulator both append the same way.

import type { AlertLog } from '../hooks/useDeviceHistory';

export const EVENT_LOG_CAP = 50;

/** Prepend one entry to a device's Event Sentry Log (newest-first), capped. Fires no event. */
export function appendEventLog(deviceId: string, entry: AlertLog): void {
  const key = `lt_event_log_${deviceId}`;
  let logs: AlertLog[] = [];
  try { logs = JSON.parse(localStorage.getItem(key) || '[]') || []; } catch { logs = []; }
  logs.unshift(entry);
  localStorage.setItem(key, JSON.stringify(logs.slice(0, EVENT_LOG_CAP)));
}
