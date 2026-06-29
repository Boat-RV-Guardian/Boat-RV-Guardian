import { describe, it, expect } from 'vitest';
import { vehicleSwitcherItems, activeVehicleLabel, vehicleTypeIcon } from './vehicleSwitcher';
import type { Vehicle } from './VehicleManager';

const mk = (id: string, name?: string, type?: string): Vehicle => ({
  id,
  config: { ...(name ? { lt_vessel_name: name } : {}), ...(type ? { lt_vehicle_type: type } : {}) } as Record<string, string>,
});

describe('vehicleSwitcherItems', () => {
  it('marks the active vehicle and sorts by name case-insensitively', () => {
    const map = { v2: mk('v2', 'zephyr'), v1: mk('v1', 'Anchor'), v3: mk('v3', 'beacon') };
    const items = vehicleSwitcherItems(map, 'v3');
    expect(items.map((i) => i.name)).toEqual(['Anchor', 'beacon', 'zephyr']);
    expect(items.find((i) => i.id === 'v3')!.active).toBe(true);
    expect(items.filter((i) => i.active)).toHaveLength(1);
  });

  it('falls back to the id when a vehicle has no name', () => {
    const items = vehicleSwitcherItems({ v1: mk('v1') }, 'v1');
    expect(items[0].name).toBe('v1');
  });

  it('handles an empty/missing map', () => {
    expect(vehicleSwitcherItems({}, '')).toEqual([]);
    expect(vehicleSwitcherItems(undefined as any, '')).toEqual([]);
  });
});

describe('vehicleTypeIcon', () => {
  it('maps boat/rv/unset', () => {
    expect(vehicleTypeIcon('boat')).toBe('⛵');
    expect(vehicleTypeIcon('rv')).toBe('🚐');
    expect(vehicleTypeIcon('')).toBe('📍');
    expect(vehicleTypeIcon(undefined)).toBe('📍');
  });
});

describe('activeVehicleLabel', () => {
  it('returns icon + name for the active vehicle', () => {
    const items = vehicleSwitcherItems({ v1: mk('v1', 'Serenity', 'boat') }, 'v1');
    expect(activeVehicleLabel(items)).toBe('⛵ Serenity');
  });

  it('falls back when nothing is active', () => {
    const items = vehicleSwitcherItems({ v1: mk('v1', 'Serenity', 'boat') }, 'nope');
    expect(activeVehicleLabel(items)).toBe('Select vehicle');
  });
});
