// Per-vehicle dashboard tile layout: which cards are shown and in what order.
//
// Kept PURE + storage-thin so the ordering rules are unit-testable. The layout is a display
// preference, stored per VEHICLE (tile ids are device ids, which belong to a vehicle) under one
// `lt_dash_layout` map. It's a user-scoped `lt_*` key, so applyUserScope wipes it on identity change
// like the rest of the per-user cache — that's intended; a layout is meaningless for another account.
//
// Self-healing by design: a saved order that references a removed device just skips it, and a device
// added since the layout was saved appears at the end rather than vanishing. That means a layout can
// never hide a NEW sensor — important, because a hidden sensor is a sensor you don't see alarm.

export interface DashLayout {
  /** Explicit tile order (device ids). Ids not listed fall back to their natural order, after these. */
  order: string[];
  /** Device ids the user chose to hide from the dashboard. */
  hidden: string[];
}

export const STORAGE_KEY = 'lt_dash_layout';

export const emptyLayout = (): DashLayout => ({ order: [], hidden: [] });

/**
 * Apply a saved order to the natural device order. Saved ids come first (in saved order, skipping any
 * that no longer exist), then any devices the layout hasn't seen, in their natural order.
 */
export function orderDevices(ids: string[], layout: DashLayout): string[] {
  const present = new Set(ids);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of layout.order) {
    if (present.has(id) && !seen.has(id)) { out.push(id); seen.add(id); }
  }
  for (const id of ids) if (!seen.has(id)) out.push(id);
  return out;
}

export function isHidden(id: string, layout: DashLayout): boolean {
  return layout.hidden.includes(id);
}

/** Visible ids, ordered. */
export function visibleDevices(ids: string[], layout: DashLayout): string[] {
  return orderDevices(ids, layout).filter((id) => !isHidden(id, layout));
}

/** Hidden ids that still exist, ordered. */
export function hiddenDevices(ids: string[], layout: DashLayout): string[] {
  return orderDevices(ids, layout).filter((id) => isHidden(id, layout));
}

export function toggleHidden(id: string, layout: DashLayout): DashLayout {
  const hidden = isHidden(id, layout) ? layout.hidden.filter((h) => h !== id) : [...layout.hidden, id];
  return { ...layout, hidden };
}

/**
 * Move a tile one slot earlier (-1) or later (+1) among the currently VISIBLE tiles, and materialise
 * the result as an explicit order. Moving among visible tiles (rather than raw indices) is what makes
 * the arrows behave the way they look — a hidden tile in between doesn't silently eat a press.
 * Returns the layout unchanged at either end.
 */
export function moveDevice(id: string, dir: -1 | 1, ids: string[], layout: DashLayout): DashLayout {
  const ordered = orderDevices(ids, layout);
  const visible = ordered.filter((d) => !isHidden(d, layout));
  const from = visible.indexOf(id);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= visible.length) return layout;

  const swapped = [...visible];
  [swapped[from], swapped[to]] = [swapped[to], swapped[from]];

  // Re-thread the hidden tiles back at their original positions so hiding/unhiding stays stable.
  const nextOrder: string[] = [];
  let v = 0;
  for (const d of ordered) nextOrder.push(isHidden(d, layout) ? d : swapped[v++]);
  return { ...layout, order: nextOrder };
}

// --- storage -------------------------------------------------------------------------------------

type LayoutMap = Record<string, DashLayout>;

const readMap = (storage: Storage): LayoutMap => {
  try {
    const raw = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
};

const sanitize = (l: any): DashLayout => ({
  order: Array.isArray(l?.order) ? l.order.filter((x: any) => typeof x === 'string') : [],
  hidden: Array.isArray(l?.hidden) ? l.hidden.filter((x: any) => typeof x === 'string') : [],
});

export function loadLayout(vehicleId: string, storage: Storage = localStorage): DashLayout {
  if (!vehicleId) return emptyLayout();
  return sanitize(readMap(storage)[vehicleId]);
}

export function saveLayout(vehicleId: string, layout: DashLayout, storage: Storage = localStorage): void {
  if (!vehicleId) return;
  const map = readMap(storage);
  map[vehicleId] = sanitize(layout);
  try { storage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch { /* quota — display preference only */ }
}

export function clearLayout(vehicleId: string, storage: Storage = localStorage): void {
  if (!vehicleId) return;
  const map = readMap(storage);
  delete map[vehicleId];
  try { storage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}
