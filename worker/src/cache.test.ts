import { describe, it, expect } from 'vitest';
import { isCacheFresh, tokenValid, tokenExpiryMs } from './cache';

describe('isCacheFresh', () => {
  it('is fresh within the TTL window', () => {
    expect(isCacheFresh(1000, 1000 + 30_000, 60_000)).toBe(true);
  });
  it('is stale once the TTL has elapsed', () => {
    expect(isCacheFresh(1000, 1000 + 60_000, 60_000)).toBe(false); // exactly at TTL = stale
    expect(isCacheFresh(1000, 1000 + 90_000, 60_000)).toBe(false);
  });
  it('treats missing / non-finite stamps as stale (fail safe → re-fetch)', () => {
    expect(isCacheFresh(null, 1000, 60_000)).toBe(false);
    expect(isCacheFresh(undefined, 1000, 60_000)).toBe(false);
    expect(isCacheFresh(NaN, 1000, 60_000)).toBe(false);
    expect(isCacheFresh(1000, NaN, 60_000)).toBe(false);
  });
});

describe('tokenValid', () => {
  it('is valid while more than the skew remains', () => {
    expect(tokenValid(100_000, 0, 60_000)).toBe(true);
  });
  it('is invalid once inside the skew headroom', () => {
    expect(tokenValid(100_000, 50_000, 60_000)).toBe(false); // 50k left < 60k skew
    expect(tokenValid(100_000, 100_000, 60_000)).toBe(false); // already expired
  });
  it('treats missing / non-finite expiry as expired', () => {
    expect(tokenValid(null, 0)).toBe(false);
    expect(tokenValid(undefined, 0)).toBe(false);
    expect(tokenValid(NaN, 0)).toBe(false);
  });
});

describe('tokenExpiryMs', () => {
  it('adds expires_in seconds to now', () => {
    expect(tokenExpiryMs(1000, 3600)).toBe(1000 + 3_600_000);
    expect(tokenExpiryMs(1000, '3600')).toBe(1000 + 3_600_000);
  });
  it('treats a missing / non-positive / garbage expires_in as already expired', () => {
    expect(tokenExpiryMs(1000, undefined)).toBe(0);
    expect(tokenExpiryMs(1000, 0)).toBe(0);
    expect(tokenExpiryMs(1000, -5)).toBe(0);
    expect(tokenExpiryMs(1000, 'nope')).toBe(0);
  });
});
