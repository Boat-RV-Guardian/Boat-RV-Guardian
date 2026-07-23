import { describe, it, expect, beforeEach } from 'vitest';
import { recordReading, getReadings, HISTORY_WINDOW_MS, MIN_SAMPLE_GAP_MS, MAX_POINTS } from './readingHistory';

const T0 = 1_800_000_000_000;

beforeEach(() => localStorage.clear());

describe('recordReading', () => {
  it('records a first point and reads it back', () => {
    expect(recordReading('dev1', 12.6, T0)).toBe(true);
    expect(getReadings('dev1', T0)).toEqual([{ t: T0, v: 12.6 }]);
  });

  it('throttles identical values inside the sample gap but keeps changed ones', () => {
    recordReading('dev1', 12.6, T0);
    expect(recordReading('dev1', 12.6, T0 + 30_000)).toBe(false); // same value, inside gap
    expect(recordReading('dev1', 12.4, T0 + 30_000)).toBe(true);  // changed value → recorded
    expect(recordReading('dev1', 12.3, T0 + 32_000)).toBe(false); // hard 15 s floor
    expect(recordReading('dev1', 12.6, T0 + MIN_SAMPLE_GAP_MS + 30_001)).toBe(true); // past gap
  });

  it('ignores non-finite values', () => {
    expect(recordReading('dev1', NaN, T0)).toBe(false);
    expect(recordReading('dev1', Infinity, T0)).toBe(false);
    expect(getReadings('dev1', T0)).toEqual([]);
  });

  it('prunes points older than the 48 h window', () => {
    recordReading('dev1', 1, T0);
    recordReading('dev1', 2, T0 + HISTORY_WINDOW_MS + 60_000);
    expect(getReadings('dev1', T0 + HISTORY_WINDOW_MS + 60_000).map((p) => p.v)).toEqual([2]);
  });

  it('caps the series length', () => {
    for (let i = 0; i < MAX_POINTS + 50; i++) recordReading('dev1', i, T0 + i * MIN_SAMPLE_GAP_MS);
    expect(getReadings('dev1', T0 + (MAX_POINTS + 50) * MIN_SAMPLE_GAP_MS).length).toBeLessThanOrEqual(MAX_POINTS);
  });

  it('survives corrupt storage', () => {
    localStorage.setItem('lt_read_hist_dev1', '{not json');
    expect(getReadings('dev1', T0)).toEqual([]);
    expect(recordReading('dev1', 5, T0)).toBe(true);
  });
});
