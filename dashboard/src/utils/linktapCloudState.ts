// Read-side of the LinkTap event-driven redesign: turn the worker-cached `sensorState/linktap_<id>`
// doc (written by brvg-cloud-server's /api/linktap from LinkTap's pushed webhook events) into a live
// valve state the app can display — WITHOUT the app polling LinkTap's cloud itself.
//
// LinkTap pushes PARTIAL events: `wateringOn`/`wateringOff` carry the open/closed state (+ battery,
// signal); `flowMeterValue` carries only the flow. The worker writes each event's fields flat onto the
// doc (a full-doc replace), so any single snapshot has just that event's fields. We therefore MERGE
// across snapshots here — keep the last-known value for a field the newest event didn't carry — so the
// app sees a coherent {watering, flow, battery, …} state instead of it flickering per event.

export interface LinkTapCloudState {
  /** The most recent LinkTap event/message name. */
  event: string;
  /** epoch ms of the most recent update. */
  at: number;
  /** Valve open? Sticky across flow-only updates until a wateringOff/watering-end arrives. */
  isWatering?: boolean;
  /** Latest flow reading (units as LinkTap sends them) from flowMeterValue. */
  flow?: number;
  battery?: number;
  signal?: number;
  /** Activated watering mode (M/I/T/O/D/Y/N), from a watering-start. */
  workMode?: string;
  /** Last alarm code seen (noWater/pbFlag/pcFlag/valveBroken/fallFlag). */
  alarm?: string;
  /** Classifier bucket the worker stamped (watering/alarm/telemetry/…). */
  kind?: string;
}

const num = (v: unknown): number | undefined => {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Merge a raw sensorState doc (flat string fields from Firestore) into the prior state, preserving
 * prior values for any field the new doc doesn't carry. Returns `prev` unchanged for an empty doc.
 */
export function mergeLinkTapSensorDoc(
  prev: LinkTapCloudState | null,
  doc: Record<string, unknown> | null | undefined,
): LinkTapCloudState | null {
  if (!doc || typeof doc !== 'object') return prev;
  const s: LinkTapCloudState = prev ? { ...prev } : { event: '', at: 0 };
  if (doc.event != null) s.event = String(doc.event);
  const at = num(doc.at);
  if (at !== undefined && at > 0) s.at = at;
  if (doc.watering != null) s.isWatering = String(doc.watering) === '1';
  const flow = num(doc.flow); if (flow !== undefined) s.flow = flow;
  const battery = num(doc.battery); if (battery !== undefined) s.battery = battery;
  const signal = num(doc.signal); if (signal !== undefined) s.signal = signal;
  if (doc.workMode != null) s.workMode = String(doc.workMode);
  if (doc.alarm != null) s.alarm = String(doc.alarm);
  if (doc.kind != null) s.kind = String(doc.kind);
  return s;
}

/** Firestore sensorState doc id for a LinkTap valve — matches the worker's `linktap_<sanitized id>`. */
export function linkTapSensorStateKey(taplinkerId: string): string {
  return `linktap_${(taplinkerId || 'unknown').replace(/[\/#?]/g, '_')}`;
}
