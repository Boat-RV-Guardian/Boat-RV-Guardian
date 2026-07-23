import { describe, it, expect, beforeEach } from 'vitest';
import { appendEventLog, EVENT_LOG_CAP } from './eventLog';

beforeEach(() => localStorage.clear());

const read = (id: string) => JSON.parse(localStorage.getItem(`lt_event_log_${id}`) || '[]');

describe('appendEventLog', () => {
  it('writes newest-first', () => {
    appendEventLog('d', { ts: 1, type: 'info', message: 'first' });
    appendEventLog('d', { ts: 2, type: 'danger', message: 'second' });
    expect(read('d').map((e: any) => e.message)).toEqual(['second', 'first']);
  });

  it('caps the log', () => {
    for (let i = 0; i < EVENT_LOG_CAP + 10; i++) appendEventLog('d', { ts: i, type: 'info', message: `m${i}` });
    const log = read('d');
    expect(log).toHaveLength(EVENT_LOG_CAP);
    expect(log[0].message).toBe(`m${EVENT_LOG_CAP + 9}`); // newest kept
  });

  it('keeps each device separate and survives corrupt storage', () => {
    localStorage.setItem('lt_event_log_bad', '{not json');
    appendEventLog('bad', { ts: 1, type: 'info', message: 'ok' });
    expect(read('bad')).toHaveLength(1);
    expect(read('other')).toHaveLength(0);
  });
});
