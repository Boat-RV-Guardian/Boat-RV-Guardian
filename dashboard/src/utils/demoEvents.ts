// Catalog of simulatable events for the event-simulator bar (DemoEventBar.tsx).
//
// Firing an event does two observable things:
//   1. pins a transient telemetry override (demoOverrides.ts) so the matching dashboard tile visibly
//      flips to the simulated state for a short window, then heals back to the animated baseline; and
//   2. appends an entry to that device's Event Sentry Log (eventLog.ts) + fires `settings_updated`, so
//      the Alerts timeline, the dashboard "needs attention" banner, and the activity feed all react.
//
// The override half only visibly changes tiles in a demo build (real builds read live telemetry, not
// the demo generators). The Event-Sentry-Log half works in ANY build — which is what makes this a
// genuine QA tool for exercising the alert/dashboard UI without hardware.
//
// Device ids match demoFleet.ts. The valve override is keyed by its taplinker id (what the valve seam
// reads), while its log is keyed by the valve's DeviceConfig id.

import type { AlertLog } from '../hooks/useDeviceHistory';
import { appendEventLog } from './eventLog';
import { setDemoOverride } from './demoOverrides';
import { DEMO_TAPLINKER_ID } from './demoFleet';

export type EventTone = 'danger' | 'warning' | 'success' | 'info';
export type EventCategory = 'Water' | 'Power' | 'Flood' | 'Climate';

export interface DemoEvent {
  id: string;
  label: string;
  icon: string;
  category: EventCategory;
  tone: EventTone;
  /** sensorState key to pin the override on (demoTelemetry doc shape). */
  overrideKey: string;
  overrideDoc: Record<string, string>;
  ttlMs?: number;
  /** DeviceConfig id whose Event Sentry Log gets the entry. */
  logDeviceId: string;
  logType: AlertLog['type'];
  logMessage: string;
}

export const DEMO_EVENTS: DemoEvent[] = [
  // ── Water / valve ──
  { id: 'valve-open', label: 'Valve opened', icon: '💧', category: 'Water', tone: 'info',
    overrideKey: DEMO_TAPLINKER_ID, overrideDoc: { watering: '1', flow: '7.9', event: 'flowMeterValue', kind: 'telemetry' },
    logDeviceId: 'demo-valve', logType: 'info', logMessage: 'Fresh-water valve opened — flowing 7.9 L/min.' },
  { id: 'valve-close', label: 'Valve closed', icon: '⏹️', category: 'Water', tone: 'info',
    overrideKey: DEMO_TAPLINKER_ID, overrideDoc: { watering: '0', flow: '0', event: 'wateringOff', kind: 'watering' },
    logDeviceId: 'demo-valve', logType: 'info', logMessage: 'Fresh-water valve closed.' },

  // ── Flood ──
  { id: 'flood-on', label: 'Flood alarm', icon: '🚨', category: 'Flood', tone: 'danger',
    overrideKey: 'demo-flood', overrideDoc: { event: 'flood.alarm on', batt: '100' },
    logDeviceId: 'demo-flood', logType: 'danger', logMessage: '🚨 Flood detected in the bilge — fresh-water valve auto-closed (safety shutoff).' },
  { id: 'flood-clear', label: 'Flood clear', icon: '✅', category: 'Flood', tone: 'success',
    overrideKey: 'demo-flood', overrideDoc: { event: 'flood.alarm inactive', batt: '100' },
    logDeviceId: 'demo-flood', logType: 'success', logMessage: 'Bilge dry again — flood cleared. Valve safe to reopen.' },

  // ── Power ──
  { id: 'shore-lost', label: 'Shore power lost', icon: '🔌', category: 'Power', tone: 'danger',
    overrideKey: 'demo-shore', overrideDoc: { event: 'pm1.voltage_change', v: '0', vraw: '0' },
    logDeviceId: 'demo-shore', logType: 'danger', logMessage: 'Shore power lost — 0 V at the inlet. Running on the house bank.' },
  { id: 'shore-high', label: 'Shore over-voltage', icon: '⚡', category: 'Power', tone: 'warning',
    overrideKey: 'demo-shore', overrideDoc: { event: 'pm1.voltage_change', v: '133', vraw: '133' },
    logDeviceId: 'demo-shore', logType: 'warning', logMessage: 'Shore over-voltage — 133 V at the inlet.' },
  { id: 'house-low', label: 'House battery low', icon: '🪫', category: 'Power', tone: 'danger',
    overrideKey: 'demo-house-batt', overrideDoc: { event: 'voltmeter.change', v: '11.6', vraw: '11.6' },
    logDeviceId: 'demo-house-batt', logType: 'danger', logMessage: 'House battery critical — 11.6 V. Shed loads.' },
  { id: 'house-charge', label: 'House charging', icon: '🔋', category: 'Power', tone: 'success',
    overrideKey: 'demo-house-batt', overrideDoc: { event: 'voltmeter.change', v: '14.1', vraw: '14.1' },
    logDeviceId: 'demo-house-batt', logType: 'success', logMessage: 'House battery charging — 14.1 V on solar/charger.' },
  { id: 'engine-low', label: 'Engine battery low', icon: '🪫', category: 'Power', tone: 'warning',
    overrideKey: 'demo-engine-batt', overrideDoc: { event: 'voltmeter.change', v: '11.9', vraw: '11.9' },
    logDeviceId: 'demo-engine-batt', logType: 'warning', logMessage: 'Engine battery low — 11.9 V.' },

  // ── Climate ──
  { id: 'freeze', label: 'Freeze warning', icon: '🧊', category: 'Climate', tone: 'danger',
    overrideKey: 'demo-climate', overrideDoc: { event: 'temperature.change', tC: '0.5', rh: '70', batt: '100' },
    logDeviceId: 'demo-climate', logType: 'danger', logMessage: '🧊 Cabin at 0.5 °C — freeze risk. Heater may have failed.' },
  { id: 'heat', label: 'Cabin heat', icon: '🥵', category: 'Climate', tone: 'warning',
    overrideKey: 'demo-climate', overrideDoc: { event: 'temperature.change', tC: '36', rh: '40', batt: '100' },
    logDeviceId: 'demo-climate', logType: 'warning', logMessage: 'Cabin hot — 36 °C. Ventilation recommended.' },
  { id: 'reefer-warm', label: 'Reefer warming', icon: '🌡️', category: 'Climate', tone: 'warning',
    overrideKey: 'demo-fridge', overrideDoc: { event: 'temperature.change', tC: '11', rh: '55', batt: '100' },
    logDeviceId: 'demo-fridge', logType: 'warning', logMessage: 'Reefer warming — 11 °C. Check the box / power.' },
];

/** The "alarm" side of each device group — what "Fire all events" triggers (one per device). */
export const FIRE_ALL_IDS = ['flood-on', 'shore-lost', 'house-low', 'engine-low', 'freeze', 'reefer-warm', 'valve-open'];

export function demoEventById(id: string): DemoEvent | undefined {
  return DEMO_EVENTS.find((e) => e.id === id);
}

/** Fire one event: pin its override + log it + notify. */
export function runDemoEvent(ev: DemoEvent, now = Date.now()): void {
  setDemoOverride(ev.overrideKey, ev.overrideDoc, ev.ttlMs ?? 25_000, now);
  appendEventLog(ev.logDeviceId, { ts: now, type: ev.logType, message: ev.logMessage });
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('settings_updated'));
}

/** Fire the representative alarm for every device, staggering the log timestamps so they read in order. */
export function runAllDemoEvents(now = Date.now()): void {
  FIRE_ALL_IDS.forEach((id, i) => {
    const ev = demoEventById(id);
    if (ev) runDemoEvent(ev, now + i); // +i ms keeps the timeline order deterministic
  });
}
