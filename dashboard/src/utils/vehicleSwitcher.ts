// Pure helpers for the global-bar vehicle switcher (Task 16 IA migration). The active vehicle is the
// most important piece of global context in this per-vehicle ("Plex") product, so the switcher lives
// in the top bar. This module derives the display list from the VehicleManager map; the component owns
// the dropdown UI and calls switchVehicle() on selection.

import type { Vehicle } from './VehicleManager';

export interface VehicleSwitcherItem {
  id: string;
  /** Display name (the vehicle's lt_vessel_name, falling back to the id). */
  name: string;
  /** 'boat' | 'rv' | '' (unset) — drives the type glyph. */
  type: string;
  active: boolean;
}

/** Map an lt_vehicle_type to a small glyph for the switcher. */
export function vehicleTypeIcon(type: string | undefined): string {
  if (type === 'boat') return '⛵';
  if (type === 'rv') return '🚐';
  return '📍';
}

/**
 * Build the switcher's display list from the vehicles map, marking the active one. Sorted
 * case-insensitively by name so the dropdown order is stable regardless of map insertion order. Pure.
 */
export function vehicleSwitcherItems(
  map: Record<string, Vehicle>,
  activeId: string,
): VehicleSwitcherItem[] {
  return Object.values(map || {})
    .map((v) => ({
      id: v.id,
      name: (v.config?.lt_vessel_name || '').trim() || v.id,
      type: v.config?.lt_vehicle_type || '',
      active: v.id === activeId,
    }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

/** The active item's label (icon + name), or a sensible fallback when nothing is active yet. */
export function activeVehicleLabel(items: VehicleSwitcherItem[]): string {
  const active = items.find((i) => i.active);
  if (!active) return 'Select vehicle';
  return `${vehicleTypeIcon(active.type)} ${active.name}`;
}
