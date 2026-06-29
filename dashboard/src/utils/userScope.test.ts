import { describe, it, expect, beforeEach } from 'vitest';
import { applyUserScope, clearUserScopedData, enterLocalMode, exitLocalMode, isLocalMode, DATA_OWNER_KEY } from './userScope';

// Per-user data isolation (2026-06-28). Verifies that switching/clearing the signed-in identity wipes
// the prior user's vehicles + secrets, while a same-user restore keeps the offline cache intact.

beforeEach(() => localStorage.clear());

function seedVehicleData() {
  localStorage.setItem('lt_vehicles', JSON.stringify({ v1: { id: 'v1', config: {} } }));
  localStorage.setItem('lt_active_vehicle_id', 'v1');
  localStorage.setItem('lt_cloud_key', 'SECRET-LINKTAP-KEY');
  localStorage.setItem('sh_local_password', 'SECRET-PW');
  localStorage.setItem('lt_vehicle_tier', 'basic');
  localStorage.setItem('lt_usage_history_dev1', '{}');
  // device-local prefs that must SURVIVE a user change
  localStorage.setItem('lt_tz', 'America/New_York');
  localStorage.setItem('lt_unit', 'imperial');
}

describe('clearUserScopedData', () => {
  it('removes lt_/sh_ user data + secrets but keeps device-local prefs and the owner stamp', () => {
    seedVehicleData();
    localStorage.setItem(DATA_OWNER_KEY, 'userA');
    const removed = clearUserScopedData(localStorage);

    expect(localStorage.getItem('lt_vehicles')).toBeNull();
    expect(localStorage.getItem('lt_cloud_key')).toBeNull();
    expect(localStorage.getItem('sh_local_password')).toBeNull();
    expect(localStorage.getItem('lt_usage_history_dev1')).toBeNull();
    // kept:
    expect(localStorage.getItem('lt_tz')).toBe('America/New_York');
    expect(localStorage.getItem('lt_unit')).toBe('imperial');
    expect(localStorage.getItem(DATA_OWNER_KEY)).toBe('userA');
    expect(removed).toContain('lt_cloud_key');
  });
});

describe('applyUserScope', () => {
  it('first sign-in on a clean device just stamps the owner (no wipe, no reload)', () => {
    const r = applyUserScope('userA', localStorage);
    expect(r.wiped).toBe(false);
    expect(localStorage.getItem(DATA_OWNER_KEY)).toBe('userA');
  });

  it('same-user restore is a no-op — offline cache survives', () => {
    seedVehicleData();
    localStorage.setItem(DATA_OWNER_KEY, 'userA');
    const r = applyUserScope('userA', localStorage);
    expect(r.wiped).toBe(false);
    expect(localStorage.getItem('lt_vehicles')).not.toBeNull();
    expect(localStorage.getItem('lt_cloud_key')).toBe('SECRET-LINKTAP-KEY');
  });

  it('login as a DIFFERENT user wipes the prior user data and re-stamps (wiped=true)', () => {
    seedVehicleData();
    localStorage.setItem(DATA_OWNER_KEY, 'userA');
    const r = applyUserScope('userB', localStorage);
    expect(r.wiped).toBe(true);
    expect(localStorage.getItem('lt_vehicles')).toBeNull();
    expect(localStorage.getItem('lt_cloud_key')).toBeNull();
    expect(localStorage.getItem(DATA_OWNER_KEY)).toBe('userB');
    expect(localStorage.getItem('lt_tz')).toBe('America/New_York'); // device pref survives
  });

  it('sign-out (uid → null) wipes data and clears the owner stamp (wiped=true)', () => {
    seedVehicleData();
    localStorage.setItem(DATA_OWNER_KEY, 'userA');
    const r = applyUserScope(null, localStorage);
    expect(r.wiped).toBe(true);
    expect(localStorage.getItem('lt_vehicles')).toBeNull();
    expect(localStorage.getItem(DATA_OWNER_KEY)).toBeNull();
  });

  it('staying signed out is a no-op', () => {
    const r = applyUserScope(null, localStorage);
    expect(r.wiped).toBe(false);
  });
});

describe('local-only mode', () => {
  it('enterLocalMode stamps a local owner and isLocalMode reports it', () => {
    expect(isLocalMode(localStorage)).toBe(false);
    const id = enterLocalMode('abc123', localStorage);
    expect(id).toBe('local:abc123');
    expect(localStorage.getItem(DATA_OWNER_KEY)).toBe('local:abc123');
    expect(isLocalMode(localStorage)).toBe(true);
  });

  it('a local session is NOT wiped by the null-user launch event (persists offline forever)', () => {
    enterLocalMode('x', localStorage);
    seedVehicleData();
    const r = applyUserScope(null, localStorage); // onAuthStateChanged(null) on every launch
    expect(r.wiped).toBe(false);
    expect(localStorage.getItem('lt_vehicles')).not.toBeNull();
    expect(isLocalMode(localStorage)).toBe(true);
  });

  it('signing into a real cloud account from local mode wipes the local session (clean switch)', () => {
    enterLocalMode('x', localStorage);
    seedVehicleData();
    const r = applyUserScope('cloudUid', localStorage);
    expect(r.wiped).toBe(true);
    expect(localStorage.getItem('lt_vehicles')).toBeNull();
    expect(localStorage.getItem(DATA_OWNER_KEY)).toBe('cloudUid');
  });

  it('exitLocalMode drops the local session + its data', () => {
    enterLocalMode('x', localStorage);
    seedVehicleData();
    exitLocalMode(localStorage);
    expect(localStorage.getItem(DATA_OWNER_KEY)).toBeNull();
    expect(localStorage.getItem('lt_vehicles')).toBeNull();
    expect(isLocalMode(localStorage)).toBe(false);
  });
});
