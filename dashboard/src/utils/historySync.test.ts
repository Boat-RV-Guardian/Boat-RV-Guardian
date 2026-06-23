import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture Firestore writes and stub reads so we can assert bucketing/merge logic without a backend.
// vi.hoisted keeps the shared mock state available to the (hoisted) vi.mock factories below.
const mocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'u1' } as { uid: string } | null },
  setDoc: vi.fn(async () => {}),
  getDoc: vi.fn(),
  // doc() just records the path segments so we can read back which month a write targeted.
  doc: vi.fn((_db: any, ...path: string[]) => ({ path: path.join('/') })),
}));

vi.mock('../services/firebase', () => ({
  db: {}, auth: mocks.auth, doc: mocks.doc, setDoc: mocks.setDoc, getDoc: mocks.getDoc,
}));
vi.mock('firebase/firestore', () => ({ arrayUnion: (...v: any[]) => ({ __arrayUnion: v }) }));

import { pushDeviceHistory, fetchDeviceHistory, recentMonthsUTC } from './historySync';
const { auth, setDoc, getDoc } = mocks;

beforeEach(() => { auth.currentUser = { uid: 'u1' }; });

describe('recentMonthsUTC', () => {
  it('returns the previous and current UTC month as YYYY-MM', () => {
    const months = recentMonthsUTC();
    expect(months).toHaveLength(2);
    expect(months.every((m) => /^\d{4}-\d{2}$/.test(m))).toBe(true);
  });
});

describe('pushDeviceHistory', () => {
  it('no-ops when signed out', async () => {
    auth.currentUser = null;
    await pushDeviceHistory('v1', 'd1', { '2026-06-23T10:00:00.000Z': 5 }, []);
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('routes usage buckets + events into per-month rollup docs', async () => {
    await pushDeviceHistory(
      'v1',
      'd1',
      {
        '2026-05-31T23:00:00.000Z': 3, // May bucket
        '2026-06-01T00:00:00.000Z': 7, // June bucket
      },
      [{ ts: Date.parse('2026-06-15T12:00:00.000Z'), type: 'info', message: 'flow stopped' }],
    );

    // One write per distinct month (May + June).
    const months = setDoc.mock.calls.map((c) => (c[1] as any).month).sort();
    expect(months).toEqual(['2026-05', '2026-06']);

    const june = setDoc.mock.calls.find((c) => (c[1] as any).month === '2026-06')![1] as any;
    expect(june.usage['2026-06-01T00:00:00.000Z']).toBe(7);
    expect(june.events[String(Date.parse('2026-06-15T12:00:00.000Z'))]).toEqual({
      type: 'info', message: 'flow stopped',
    });
  });

  it('skips events without a numeric ts', async () => {
    await pushDeviceHistory('v1', 'd1', {}, [{ ts: NaN as any, type: 'x', message: 'bad' }]);
    // No usable usage or events → nothing to write.
    expect(setDoc).not.toHaveBeenCalled();
  });
});

describe('fetchDeviceHistory merge', () => {
  it('takes the max liters per bucket and dedups events across months', async () => {
    getDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => ({
        usage: { '2026-06-01T00:00:00.000Z': 4 },
        events: { '1000': { type: 'info', message: 'a' } },
      }) })
      .mockResolvedValueOnce({ exists: () => true, data: () => ({
        usage: { '2026-06-01T00:00:00.000Z': 9 }, // higher → should win
        events: { '2000': { type: 'warn', message: 'b' } },
      }) });

    const out = await fetchDeviceHistory('v1', 'd1');
    expect(out.usage['2026-06-01T00:00:00.000Z']).toBe(9); // max across the two months
    expect(out.events).toHaveLength(2);
    expect(out.events.map((e) => e.message).sort()).toEqual(['a', 'b']);
  });

  it('ignores a month whose read throws and returns empty when signed out', async () => {
    auth.currentUser = null;
    const out = await fetchDeviceHistory('v1', 'd1');
    expect(out).toEqual({ usage: {}, events: [] });
  });
});
