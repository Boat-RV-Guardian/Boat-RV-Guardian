import { describe, it, expect, vi, beforeEach } from 'vitest';

// getMyRole / getMembers only read auth.currentUser?.uid, so a tiny mutable auth stub is enough.
// We never exercise the Firestore write paths here. vi.hoisted lets the (hoisted) mock factory
// reference this shared state without a "cannot access before initialization" error.
const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as { uid: string; email?: string } | null },
}));
vi.mock('../services/firebase', () => ({ auth: mocks.auth, db: {} }));

import { getMyRole, getMembers, getOwner, isOwner } from './sharing';
const auth = mocks.auth;

beforeEach(() => { auth.currentUser = null; });

describe('getMyRole', () => {
  it('returns null when no user is signed in', () => {
    expect(getMyRole({ members: { u1: { role: 'admin' } } })).toBeNull();
  });

  it('returns the explicit role from the members map', () => {
    auth.currentUser = { uid: 'u1' };
    expect(getMyRole({ members: { u1: { role: 'monitor', email: 'a@b.c' } } })).toBe('monitor');
  });

  it('treats a legacy member (in allowedUsers, no members entry) as admin', () => {
    auth.currentUser = { uid: 'owner' };
    expect(getMyRole({ allowedUsers: ['owner'] })).toBe('admin');
  });

  it('returns null for a user who is neither a member nor in allowedUsers', () => {
    auth.currentUser = { uid: 'stranger' };
    expect(getMyRole({ members: { u1: { role: 'admin' } }, allowedUsers: ['u1'] })).toBeNull();
  });

  it('returns null for missing vehicle data', () => {
    auth.currentUser = { uid: 'u1' };
    expect(getMyRole(null)).toBeNull();
  });
});

describe('getMembers', () => {
  it('maps the members object to a list, defaulting missing fields', () => {
    const members = getMembers({ members: {
      u1: { role: 'admin', email: 'a@b.c' },
      u2: {}, // missing role/email → defaults
    } });
    expect(members).toContainEqual({ uid: 'u1', role: 'admin', email: 'a@b.c' });
    expect(members).toContainEqual({ uid: 'u2', role: 'monitor', email: '(unknown)' });
  });

  it('returns an empty list when there are no members', () => {
    expect(getMembers({})).toEqual([]);
    expect(getMembers(null)).toEqual([]);
  });
});

describe('getOwner / isOwner', () => {
  it('reads the explicit owner field', () => {
    expect(getOwner({ owner: 'u1', allowedUsers: ['u1', 'u2'] })).toBe('u1');
    expect(isOwner({ owner: 'u1' }, 'u1')).toBe(true);
    expect(isOwner({ owner: 'u1' }, 'u2')).toBe(false);
  });
  it('falls back to the sole member of a legacy vehicle with no owner field', () => {
    expect(getOwner({ allowedUsers: ['only'] })).toBe('only');
    expect(getOwner({ allowedUsers: ['a', 'b'] })).toBeNull(); // ambiguous → no owner
    expect(getOwner({})).toBeNull();
  });
});
