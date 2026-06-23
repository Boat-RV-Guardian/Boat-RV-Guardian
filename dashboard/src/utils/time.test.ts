import { describe, it, expect, beforeEach } from 'vitest';
import { getDisplayTimeZone, formatTime, formatDate, formatDateTime } from './time';

// A fixed UTC instant: 2026-06-23T15:30:00Z. In America/New_York (EDT, UTC-4) that is 11:30,
// in UTC it is 15:30 — the gap is what proves the helpers honor lt_tz rather than the host zone.
const UTC_INSTANT = '2026-06-23T15:30:00.000Z';

describe('getDisplayTimeZone', () => {
  beforeEach(() => localStorage.clear());

  it('returns the lt_tz preference when set', () => {
    localStorage.setItem('lt_tz', 'America/New_York');
    expect(getDisplayTimeZone()).toBe('America/New_York');
  });

  it('falls back to the OS-resolved zone when lt_tz is unset', () => {
    // jsdom resolves a real IANA zone; we only assert it is a non-empty string, not its value.
    expect(getDisplayTimeZone()).toBeTruthy();
    expect(typeof getDisplayTimeZone()).toBe('string');
  });
});

describe('formatters honor lt_tz', () => {
  beforeEach(() => localStorage.clear());

  it('formatTime renders in the configured zone (UTC vs New York differ)', () => {
    localStorage.setItem('lt_tz', 'UTC');
    const utc = formatTime(UTC_INSTANT, { hour: '2-digit', minute: '2-digit', hour12: false });
    localStorage.setItem('lt_tz', 'America/New_York');
    const ny = formatTime(UTC_INSTANT, { hour: '2-digit', minute: '2-digit', hour12: false });

    expect(utc).toContain('15:30');
    expect(ny).toContain('11:30');
    expect(utc).not.toBe(ny);
  });

  it('formatDate can roll to the previous calendar day across the zone offset', () => {
    // 00:30Z on the 23rd is still 20:30 on the 22nd in New York.
    const earlyUtc = '2026-06-23T00:30:00.000Z';
    localStorage.setItem('lt_tz', 'UTC');
    const utcDay = formatDate(earlyUtc, { day: '2-digit' });
    localStorage.setItem('lt_tz', 'America/New_York');
    const nyDay = formatDate(earlyUtc, { day: '2-digit' });

    expect(utcDay).toContain('23');
    expect(nyDay).toContain('22');
  });

  it('accepts Date, epoch-ms, and ISO-string inputs equivalently', () => {
    localStorage.setItem('lt_tz', 'UTC');
    const ms = Date.parse(UTC_INSTANT);
    const opts = { hour: '2-digit', minute: '2-digit', hour12: false } as const;
    const fromIso = formatTime(UTC_INSTANT, opts);
    const fromMs = formatTime(ms, opts);
    const fromDate = formatTime(new Date(ms), opts);
    expect(fromIso).toBe(fromMs);
    expect(fromMs).toBe(fromDate);
  });

  it('falls back to the browser zone (no throw) when lt_tz is an invalid zone', () => {
    localStorage.setItem('lt_tz', 'Not/AZone');
    expect(() => formatDateTime(UTC_INSTANT)).not.toThrow();
    expect(formatDateTime(UTC_INSTANT)).toBeTruthy();
  });
});
