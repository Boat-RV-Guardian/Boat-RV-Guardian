import { describe, it, expect, vi } from 'vitest';
import { accountDeletionPlan, classifyForDeletion, executeAccountDeletion, type DeletionDeps, type VehicleAccess } from './accountDeletion';

describe('classifyForDeletion', () => {
  const vehicles: VehicleAccess[] = [
    { id: 'solo', allowedUsers: ['me'], owner: 'me' },                  // sole → delete
    { id: 'mine-shared', allowedUsers: ['me', 'b', 'c'], owner: 'me' }, // I own + others → decide
    { id: 'theirs', allowedUsers: ['me', 'b'], owner: 'b' },            // shared with me → leave
    { id: 'notmine', allowedUsers: ['x', 'y'], owner: 'x' },            // not a member → ignored
  ];
  it('separates solo-delete, owned-shared (transfer decision), and leave', () => {
    const c = classifyForDeletion(vehicles, 'me');
    expect(c.toDelete).toEqual(['solo']);
    expect(c.ownedShared).toEqual([{ id: 'mine-shared', others: ['b', 'c'] }]);
    expect(c.toLeave).toEqual(['theirs']);
  });
  it('a sole member is always a delete even without an owner field', () => {
    expect(classifyForDeletion([{ id: 'v', allowedUsers: ['me'] }], 'me').toDelete).toEqual(['v']);
  });
});

describe('accountDeletionPlan', () => {
  const vehicles: VehicleAccess[] = [
    { id: 'solo', allowedUsers: ['me'] },
    { id: 'shared', allowedUsers: ['me', 'friend'] },
    { id: 'notmine', allowedUsers: ['someone'] },
    { id: 'soloDup', allowedUsers: ['me', 'me'] }, // defensive: duplicate self still = sole member
  ];
  it('deletes solo-owned vehicles, leaves shared ones, ignores others', () => {
    expect(accountDeletionPlan(vehicles, 'me')).toEqual({ toDelete: ['solo', 'soloDup'], toLeave: ['shared'] });
  });
  it('handles missing/!array allowedUsers safely', () => {
    expect(accountDeletionPlan([{ id: 'x', allowedUsers: undefined as any }], 'me')).toEqual({ toDelete: [], toLeave: [] });
  });
});

function mockDeps(over: Partial<DeletionDeps> = {}) {
  return {
    deleteVehicle: vi.fn(async () => {}),
    leaveVehicle: vi.fn(async () => {}),
    deleteUserDoc: vi.fn(async () => {}),
    deleteAuthUser: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    clearLocal: vi.fn(),
    ...over,
  };
}

describe('executeAccountDeletion', () => {
  it('runs every step and clears local data on the happy path', async () => {
    const deps = mockDeps();
    const res = await executeAccountDeletion({ toDelete: ['a'], toLeave: ['b'] }, 'me', deps);
    expect(res).toEqual({ deletedVehicles: 1, leftVehicles: 1, errors: [] });
    expect(deps.deleteVehicle).toHaveBeenCalledWith('a');
    expect(deps.leaveVehicle).toHaveBeenCalledWith('b', 'me');
    expect(deps.deleteUserDoc).toHaveBeenCalledWith('me');
    expect(deps.deleteAuthUser).toHaveBeenCalled();
    expect(deps.clearLocal).toHaveBeenCalled();
    expect(deps.signOut).not.toHaveBeenCalled(); // auth delete succeeded → no extra signout needed
  });

  it('records a per-vehicle error without aborting the rest', async () => {
    const deps = mockDeps({ deleteVehicle: vi.fn(async () => { throw new Error('boom'); }) });
    const res = await executeAccountDeletion({ toDelete: ['a'], toLeave: ['b'] }, 'me', deps);
    expect(res.deletedVehicles).toBe(0);
    expect(res.leftVehicles).toBe(1);
    expect(res.errors[0]).toMatch(/delete a: boom/);
    expect(deps.clearLocal).toHaveBeenCalled(); // cleanup still runs
  });

  it('signs out as a fallback when the Auth user delete fails (requires-recent-login)', async () => {
    const deps = mockDeps({ deleteAuthUser: vi.fn(async () => { throw new Error('requires-recent-login'); }) });
    const res = await executeAccountDeletion({ toDelete: [], toLeave: [] }, 'me', deps);
    expect(res.errors.some((e) => /auth: requires-recent-login/.test(e))).toBe(true);
    expect(deps.signOut).toHaveBeenCalled();
    expect(deps.clearLocal).toHaveBeenCalled();
  });
});
