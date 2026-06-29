import { describe, it, expect } from 'vitest';
import { mergeDeviceLogs, currentIssues, MAX_MERGED_EVENTS } from './alerts';
import type { AlertLog } from '../hooks/useDeviceHistory';

const log = (ts: number, type: AlertLog['type'], message = 'm'): AlertLog => ({ ts, type, message });

describe('mergeDeviceLogs', () => {
  it('merges per-device logs newest-first and attaches device info', () => {
    const reads: Record<string, AlertLog[]> = {
      d1: [log(100, 'info', 'a'), log(300, 'danger', 'c')],
      d2: [log(200, 'warning', 'b')],
    };
    const events = mergeDeviceLogs([{ id: 'd1', name: 'Bilge' }, { id: 'd2' }], (id) => reads[id] || []);
    expect(events.map((e) => e.message)).toEqual(['c', 'b', 'a']);
    expect(events[0]).toMatchObject({ deviceId: 'd1', deviceName: 'Bilge', ts: 300 });
    expect(events[1].deviceName).toBe('d2'); // falls back to id
  });

  it('drops entries with a non-finite ts', () => {
    const events = mergeDeviceLogs([{ id: 'd1' }], () => [log(NaN, 'info'), log(5, 'info')]);
    expect(events).toHaveLength(1);
    expect(events[0].ts).toBe(5);
  });

  it('caps the merged list', () => {
    const many = Array.from({ length: 300 }, (_, i) => log(i, 'info'));
    const events = mergeDeviceLogs([{ id: 'd1' }], () => many);
    expect(events).toHaveLength(MAX_MERGED_EVENTS);
  });
});

describe('currentIssues', () => {
  const now = 1_000_000;
  it('surfaces the newest in-window danger/warning per device', () => {
    const events = mergeDeviceLogs(
      [{ id: 'd1', name: 'Bilge' }, { id: 'd2', name: 'Batt' }],
      (id) => (id === 'd1' ? [log(now - 1000, 'danger', 'flood')] : [log(now - 2000, 'warning', 'low')]),
    );
    const issues = currentIssues(events, now);
    expect(issues.map((i) => i.deviceName)).toEqual(['Bilge', 'Batt']);
  });

  it('treats a device as resolved when its newest in-window event is not an alert', () => {
    // d1's newest event is 'success' (cleared) even though an earlier 'danger' exists → no issue.
    const events = mergeDeviceLogs([{ id: 'd1' }], () => [log(now - 100, 'success', 'cleared'), log(now - 5000, 'danger', 'flood')]);
    expect(currentIssues(events, now)).toHaveLength(0);
  });

  it('ignores events older than the window', () => {
    const events = mergeDeviceLogs([{ id: 'd1' }], () => [log(now - 48 * 3600 * 1000, 'danger')]);
    expect(currentIssues(events, now)).toHaveLength(0);
  });
});
