// DEMO scenario driver: turns the scripted flood incident (demoFloodAlarmActive) into entries in the
// app's real Alerts timeline. Each device keeps its Event Sentry Log in localStorage
// (`lt_event_log_<deviceConfigId>`, an AlertLog[]); Alerts.tsx merges those. We append to the flood
// device's log on each rising/falling edge and fire `settings_updated` so Alerts re-reads.
//
// Safe from the useDeviceHistory persist-race: ShellyWidget (which renders the flood device) does NOT
// use useDeviceHistory, so nothing re-persists `lt_event_log_demo-flood` over our writes.

import { useEffect } from 'react';
import type { AlertLog } from './useDeviceHistory';
import { demoFloodAlarmActive } from '../utils/demoTelemetry';

const HOUR = 3_600_000;

function appendDemoAlert(deviceConfigId: string, type: AlertLog['type'], message: string, ts: number): void {
  const key = `lt_event_log_${deviceConfigId}`;
  let logs: AlertLog[] = [];
  try { logs = JSON.parse(localStorage.getItem(key) || '[]') || []; } catch { logs = []; }
  logs.unshift({ ts, type, message });
  localStorage.setItem(key, JSON.stringify(logs.slice(0, 50)));
}

// A little believable backstory so the Alerts tab isn't empty when a visitor first lands (before the
// first live flood fires). Seeded once; subsequent live events prepend to it.
function seedDemoHistoryOnce(now: number): void {
  if (localStorage.getItem('lt_event_log_demo-flood')) return; // already have events — don't reseed
  appendDemoAlert('demo-house-batt', 'warning', 'House battery dipped to 12.1 V overnight — recovered on solar.', now - 8 * HOUR);
  appendDemoAlert('demo-shore', 'info', 'Shore power connected — 120 V steady.', now - 5 * HOUR);
  appendDemoAlert('demo-flood', 'success', 'Bilge dry — routine sensor check OK.', now - 3 * HOUR);
}

/** Run the scripted demo incidents. No-op outside a `--mode demo` build. */
export function useDemoScenario(): void {
  useEffect(() => {
    if (!__DEMO__) return;
    seedDemoHistoryOnce(Date.now());
    let prev = demoFloodAlarmActive(Date.now());
    const id = setInterval(() => {
      const now = Date.now();
      const cur = demoFloodAlarmActive(now);
      if (cur && !prev) {
        appendDemoAlert('demo-flood', 'danger', '🚨 Flood detected in the bilge — fresh-water valve auto-closed (safety shutoff).', now);
        window.dispatchEvent(new Event('settings_updated'));
      } else if (!cur && prev) {
        appendDemoAlert('demo-flood', 'success', 'Bilge dry again — flood cleared. Valve safe to reopen.', now);
        window.dispatchEvent(new Event('settings_updated'));
      }
      prev = cur;
    }, 1000);
    return () => clearInterval(id);
  }, []);
}
