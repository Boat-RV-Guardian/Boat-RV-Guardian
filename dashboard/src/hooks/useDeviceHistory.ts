// Per-device usage-history + Event Sentry Log state and persistence, extracted from LinkTapWidget.
//
// Owns two pieces of on-device state (both keyed by deviceId):
//   - usageHistory: localStorage['lt_usage_history_<id>'] — UTC-ISO hour buckets → liters
//   - logs:         localStorage['lt_event_log_<id>']      — the Event Sentry Log (capped 50)
// and, when cloud history is enabled (lt_store_history_cloud), mirrors both to monthly rollup docs
// via utils/historySync (read-and-merge on mount/login, debounced push on change). See CLAUDE.md
// "Where historical / event data lives". Behavior is unchanged from the original inline version.
import { useState, useEffect, useRef } from 'react';
import { getActiveVehicleId } from '../utils/VehicleManager';
import { pushDeviceHistory, fetchDeviceHistory, recentMonthsUTC } from '../utils/historySync';
import { auth } from '../services/firebase';

export interface AlertLog {
  ts: number; // epoch ms (UTC) — formatted for display via utils/time
  type: 'info' | 'warning' | 'danger' | 'success';
  message: string;
}

export interface DeviceHistory {
  usageHistory: Record<string, number>;
  setUsageHistory: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  logs: AlertLog[];
  setLogs: React.Dispatch<React.SetStateAction<AlertLog[]>>;
  addLog: (type: AlertLog['type'], message: string) => void;
}

export function useDeviceHistory(deviceId: string, storeHistoryCloud: boolean): DeviceHistory {
  const historyPushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [usageHistory, setUsageHistory] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem(`lt_usage_history_${deviceId}`) || '{}'); } catch { return {}; }
  });

  const [logs, setLogs] = useState<AlertLog[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(`lt_event_log_${deviceId}`) || 'null');
      if (Array.isArray(stored) && stored.length > 0) return stored;
    } catch { /* fall through to seed */ }
    return [{ ts: Date.now(), type: 'info', message: 'Boat Guard dashboard initialized.' }];
  });

  useEffect(() => {
    localStorage.setItem(`lt_usage_history_${deviceId}`, JSON.stringify(usageHistory));
  }, [usageHistory, deviceId]);

  // Persist the Event Sentry Log so it survives reloads (capped at 50 entries by addLog)
  useEffect(() => {
    localStorage.setItem(`lt_event_log_${deviceId}`, JSON.stringify(logs));
  }, [logs, deviceId]);

  // Cloud history (opt-in via lt_store_history_cloud): read back the last ~30 days on mount/login
  // and merge into local state, so a new device sees prior usage & events.
  useEffect(() => {
    if (!storeHistoryCloud || !auth.currentUser) return;
    let cancelled = false;
    (async () => {
      const { usage, events } = await fetchDeviceHistory(getActiveVehicleId(), deviceId);
      if (cancelled) return;
      if (Object.keys(usage).length) {
        setUsageHistory(prev => {
          const merged = { ...prev };
          for (const [iso, l] of Object.entries(usage)) merged[iso] = Math.max(merged[iso] || 0, l);
          return merged;
        });
      }
      if (events.length) {
        setLogs(prev => {
          const seen = new Set(prev.map(l => `${l.ts}|${l.message}`));
          const fresh = events
            .filter(e => !seen.has(`${e.ts}|${e.message}`))
            .map(e => ({ ts: e.ts, type: e.type as AlertLog['type'], message: e.message }));
          return [...prev, ...fresh].sort((a, b) => b.ts - a.ts).slice(0, 50);
        });
      }
    })();
    return () => { cancelled = true; };
  }, [deviceId, storeHistoryCloud]);

  // Cloud history: debounced push of the current/previous month's usage + events.
  useEffect(() => {
    if (!storeHistoryCloud || !auth.currentUser) return;
    if (historyPushTimer.current) clearTimeout(historyPushTimer.current);
    historyPushTimer.current = setTimeout(() => {
      const months = new Set(recentMonthsUTC());
      const usageRecent = Object.fromEntries(
        Object.entries(usageHistory).filter(([iso]) => months.has(iso.slice(0, 7)))
      );
      const eventsRecent = logs.filter(l => months.has(new Date(l.ts).toISOString().slice(0, 7)));
      pushDeviceHistory(getActiveVehicleId(), deviceId, usageRecent, eventsRecent).catch(() => {});
    }, 10000);
    return () => { if (historyPushTimer.current) clearTimeout(historyPushTimer.current); };
  }, [usageHistory, logs, deviceId, storeHistoryCloud]);

  // Log message helper
  const addLog = (type: AlertLog['type'], message: string) => {
    setLogs((prev) => [{ ts: Date.now(), type, message }, ...prev.slice(0, 49)]);
  };

  return { usageHistory, setUsageHistory, logs, setLogs, addLog };
}
