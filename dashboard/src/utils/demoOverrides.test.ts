import { describe, it, expect, beforeEach } from 'vitest';
import {
  setDemoOverride, getDemoOverride, clearDemoOverrides, hasActiveOverrides, mergeDemoDoc,
} from './demoOverrides';

beforeEach(() => sessionStorage.clear());

const T0 = 1_800_000_000_000;

describe('mergeDemoDoc', () => {
  it('returns the base unchanged when there is no override', () => {
    const base = { event: 'x', v: '12' };
    expect(mergeDemoDoc(base, null)).toBe(base);
  });
  it('lets override fields win while keeping base fields the override omits', () => {
    expect(mergeDemoDoc({ event: 'a', at: '1', battery: '90' }, { event: 'b', v: '0' }))
      .toEqual({ event: 'b', at: '1', battery: '90', v: '0' });
  });
});

describe('override store', () => {
  it('sets and reads back an override within its TTL', () => {
    setDemoOverride('dev1', { v: '11.6' }, 25_000, T0);
    expect(getDemoOverride('dev1', T0 + 10_000)).toEqual({ v: '11.6' });
  });
  it('expires after the TTL and prunes itself', () => {
    setDemoOverride('dev1', { v: '11.6' }, 25_000, T0);
    expect(getDemoOverride('dev1', T0 + 25_001)).toBeNull();
    // pruned: a subsequent read at an earlier time is still gone
    expect(sessionStorage.getItem('demo_overrides')).toBe('{}');
  });
  it('ttlMs=0 is sticky until cleared', () => {
    setDemoOverride('dev1', { watering: '1' }, 0, T0);
    expect(getDemoOverride('dev1', T0 + 10 * 60_000)).toEqual({ watering: '1' });
  });
  it('hasActiveOverrides reflects live entries', () => {
    expect(hasActiveOverrides(T0)).toBe(false);
    setDemoOverride('dev1', { v: '0' }, 25_000, T0);
    expect(hasActiveOverrides(T0 + 1000)).toBe(true);
    expect(hasActiveOverrides(T0 + 30_000)).toBe(false);
  });
  it('clearDemoOverrides drops everything', () => {
    setDemoOverride('a', { v: '1' }, 25_000, T0);
    setDemoOverride('b', { v: '2' }, 25_000, T0);
    clearDemoOverrides();
    expect(getDemoOverride('a', T0)).toBeNull();
    expect(getDemoOverride('b', T0)).toBeNull();
  });
  it('survives corrupt session storage', () => {
    sessionStorage.setItem('demo_overrides', '{bad json');
    expect(getDemoOverride('a', T0)).toBeNull();
    setDemoOverride('a', { v: '1' }, 25_000, T0);
    expect(getDemoOverride('a', T0)).toEqual({ v: '1' });
  });
});
