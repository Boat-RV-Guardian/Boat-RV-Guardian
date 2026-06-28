import { describe, it, expect } from 'vitest';
import { usageHistoryToCsv } from './historyCsv';

describe('usageHistoryToCsv', () => {
  it('emits a header and one row per bucket, sorted by timestamp', () => {
    const csv = usageHistoryToCsv([
      { device: 'tank', usage: { '2026-06-02T03:00:00.000Z': 5, '2026-06-01T00:00:00.000Z': 2 } },
    ]);
    expect(csv.split('\n')).toEqual([
      'device,timestamp_utc,liters',
      'tank,2026-06-01T00:00:00.000Z,2',
      'tank,2026-06-02T03:00:00.000Z,5',
    ]);
  });

  it('merges multiple devices and breaks timestamp ties by device', () => {
    const csv = usageHistoryToCsv([
      { device: 'b', usage: { '2026-06-01T00:00:00.000Z': 1 } },
      { device: 'a', usage: { '2026-06-01T00:00:00.000Z': 9 } },
    ]);
    expect(csv.split('\n').slice(1)).toEqual([
      'a,2026-06-01T00:00:00.000Z,9',
      'b,2026-06-01T00:00:00.000Z,1',
    ]);
  });

  it('skips non-finite liter values and tolerates empty input', () => {
    const csv = usageHistoryToCsv([{ device: 'd', usage: { '2026-06-01T00:00:00.000Z': NaN as any } }]);
    expect(csv).toBe('device,timestamp_utc,liters'); // header only
    expect(usageHistoryToCsv([])).toBe('device,timestamp_utc,liters');
  });

  it('escapes a device name containing a comma', () => {
    const csv = usageHistoryToCsv([{ device: 'tank,1', usage: { '2026-06-01T00:00:00.000Z': 3 } }]);
    expect(csv.split('\n')[1]).toBe('"tank,1",2026-06-01T00:00:00.000Z,3');
  });
});
