import { describe, it, expect, beforeEach } from 'vitest';
import {
  stashPendingMigration, readPendingMigration, hasPendingMigration, markMigrated, clearPendingMigration,
  PENDING_MIGRATION_KEY,
} from './migrateLocalToCloud';
import { clearUserScopedData } from './userScope';
import type { Vehicle } from './VehicleManager';

// Migrate-local-to-cloud stash (Task 15). The core invariant under test: the stash key survives
// clearUserScopedData (the wipe that runs when sign-in flips the owning identity), because that's the
// entire reason this lives outside the lt_/sh_ namespace.

beforeEach(() => localStorage.clear());

const vehicles: Record<string, Vehicle> = {
  v1: { id: 'v1', config: { lt_vessel_name: 'Boat One' } },
  v2: { id: 'v2', config: { lt_vessel_name: 'Boat Two' } },
};

describe('stashPendingMigration / readPendingMigration', () => {
  it('round-trips a vehicles map', () => {
    stashPendingMigration(vehicles, localStorage, 1000);
    const read = readPendingMigration(localStorage);
    expect(read).not.toBeNull();
    expect(read!.vehicles).toEqual(vehicles);
    expect(read!.startedAt).toBe(1000);
  });

  it('is a no-op (and clears any stale stash) for an empty vehicle map', () => {
    localStorage.setItem(PENDING_MIGRATION_KEY, JSON.stringify({ vehicles: { stale: {} }, startedAt: 1 }));
    stashPendingMigration({}, localStorage);
    expect(localStorage.getItem(PENDING_MIGRATION_KEY)).toBeNull();
    expect(readPendingMigration(localStorage)).toBeNull();
  });

  it('tolerates missing storage (returns null, not a throw)', () => {
    expect(readPendingMigration(localStorage)).toBeNull();
  });

  it('tolerates corrupt JSON (returns null, not a throw)', () => {
    localStorage.setItem(PENDING_MIGRATION_KEY, '{not valid json');
    expect(readPendingMigration(localStorage)).toBeNull();
  });

  it('tolerates well-formed JSON with the wrong shape', () => {
    localStorage.setItem(PENDING_MIGRATION_KEY, JSON.stringify({ foo: 'bar' }));
    expect(readPendingMigration(localStorage)).toBeNull();
    localStorage.setItem(PENDING_MIGRATION_KEY, JSON.stringify('just a string'));
    expect(readPendingMigration(localStorage)).toBeNull();
    localStorage.setItem(PENDING_MIGRATION_KEY, JSON.stringify(null));
    expect(readPendingMigration(localStorage)).toBeNull();
  });

  it('defaults a missing/garbage startedAt to 0 rather than throwing', () => {
    localStorage.setItem(PENDING_MIGRATION_KEY, JSON.stringify({ vehicles: { v1: {} } }));
    expect(readPendingMigration(localStorage)!.startedAt).toBe(0);
  });
});

describe('hasPendingMigration', () => {
  it('false when nothing is stashed', () => {
    expect(hasPendingMigration(localStorage)).toBe(false);
  });

  it('true once a non-empty migration is stashed', () => {
    stashPendingMigration(vehicles, localStorage);
    expect(hasPendingMigration(localStorage)).toBe(true);
  });

  it('false again once every vehicle has been marked migrated', () => {
    stashPendingMigration(vehicles, localStorage);
    markMigrated('v1', localStorage);
    markMigrated('v2', localStorage);
    expect(hasPendingMigration(localStorage)).toBe(false);
  });
});

describe('markMigrated', () => {
  it('removes only the named vehicle, keeping the rest staged for retry', () => {
    stashPendingMigration(vehicles, localStorage);
    markMigrated('v1', localStorage);
    const read = readPendingMigration(localStorage);
    expect(read!.vehicles).toEqual({ v2: vehicles.v2 });
  });

  it('clears the stash key entirely once the last vehicle is confirmed', () => {
    stashPendingMigration({ v1: vehicles.v1 }, localStorage);
    markMigrated('v1', localStorage);
    expect(localStorage.getItem(PENDING_MIGRATION_KEY)).toBeNull();
  });

  it('is a no-op when nothing is stashed', () => {
    expect(() => markMigrated('v1', localStorage)).not.toThrow();
    expect(readPendingMigration(localStorage)).toBeNull();
  });

  it('is a no-op for an id not present in the stash', () => {
    stashPendingMigration(vehicles, localStorage);
    markMigrated('does-not-exist', localStorage);
    expect(readPendingMigration(localStorage)!.vehicles).toEqual(vehicles);
  });
});

describe('clearPendingMigration', () => {
  it('discards the stash outright', () => {
    stashPendingMigration(vehicles, localStorage);
    clearPendingMigration(localStorage);
    expect(readPendingMigration(localStorage)).toBeNull();
  });

  it('is a no-op when nothing is stashed', () => {
    expect(() => clearPendingMigration(localStorage)).not.toThrow();
  });
});

describe('survives the per-user wipe (the entire reason this key is namespaced outside lt_/sh_)', () => {
  it('clearUserScopedData does not remove the pending-migration stash', () => {
    stashPendingMigration(vehicles, localStorage);
    localStorage.setItem('lt_vehicles', JSON.stringify(vehicles)); // sanity: this DOES get wiped
    clearUserScopedData(localStorage);
    expect(localStorage.getItem('lt_vehicles')).toBeNull();
    expect(readPendingMigration(localStorage)!.vehicles).toEqual(vehicles);
  });
});
