import { describe, it, expect } from 'vitest';
import {
  parseSmsPrefs, serializeSmsPrefs, normalizePhone, addPhone, removePhone, setEventEnabled,
  normalizeEmail, addEmail, EMPTY_SMS_PREFS, type SmsPrefs,
} from './smsPrefs';

describe('parse/serialize', () => {
  it('returns empty prefs for blank/corrupt input', () => {
    expect(parseSmsPrefs('')).toEqual(EMPTY_SMS_PREFS);
    expect(parseSmsPrefs(null)).toEqual(EMPTY_SMS_PREFS);
    expect(parseSmsPrefs('not json')).toEqual(EMPTY_SMS_PREFS);
    expect(parseSmsPrefs('{"phones":"oops"}')).toEqual(EMPTY_SMS_PREFS);
  });
  it('parses, trims, and de-dupes', () => {
    expect(parseSmsPrefs('{"phones":[" +1555 ","+1555",""],"events":["flood","flood"]}'))
      .toEqual({ phones: ['+1555'], events: ['flood'] });
  });
  it('round-trips through serialize → parse', () => {
    const p: SmsPrefs = { phones: ['+15551112222'], events: ['flood', 'offline'] };
    expect(parseSmsPrefs(serializeSmsPrefs(p))).toEqual(p);
  });
});

describe('normalizePhone', () => {
  it('keeps an optional + and 7–15 digits, stripping formatting', () => {
    expect(normalizePhone('+1 (555) 111-2222')).toBe('+15551112222');
    expect(normalizePhone('5551112222')).toBe('5551112222');
  });
  it('rejects too-short / too-long', () => {
    expect(normalizePhone('12345')).toBeNull();      // 5 digits
    expect(normalizePhone('+1234567890123456')).toBeNull(); // 16 digits
    expect(normalizePhone('')).toBeNull();
  });
});

describe('addPhone / removePhone', () => {
  it('adds a normalized phone, ignoring invalid + duplicates', () => {
    let p = EMPTY_SMS_PREFS;
    p = addPhone(p, '+1 (555) 111-2222');
    expect(p.phones).toEqual(['+15551112222']);
    expect(addPhone(p, '+15551112222')).toBe(p);   // duplicate → same ref (no-op)
    expect(addPhone(p, '123')).toBe(p);            // invalid → no-op
  });
  it('removes a phone', () => {
    const p: SmsPrefs = { phones: ['a', 'b'], events: [] };
    expect(removePhone(p, 'a')).toEqual({ phones: ['b'], events: [] });
    expect(removePhone(p, 'z')).toBe(p);            // absent → no-op
  });
});

describe('normalizeEmail / addEmail', () => {
  it('lowercases + trims a valid email and rejects junk', () => {
    expect(normalizeEmail(' Skipper@Boat.COM ')).toBe('skipper@boat.com');
    expect(normalizeEmail('nope')).toBeNull();
    expect(normalizeEmail('a@b')).toBeNull();
  });
  it('adds a valid email once (reusing the phones address list); no-ops on invalid/dupe', () => {
    const p1 = addEmail(EMPTY_SMS_PREFS, 'Crew@Ship.io');
    expect(p1.phones).toEqual(['crew@ship.io']);
    expect(addEmail(p1, 'crew@ship.io')).toBe(p1); // dupe → same ref
    expect(addEmail(p1, 'garbage')).toBe(p1);       // invalid → same ref
  });
});

describe('setEventEnabled', () => {
  it('opts an event in and out idempotently', () => {
    let p: SmsPrefs = { phones: [], events: [] };
    p = setEventEnabled(p, 'flood', true);
    expect(p.events).toEqual(['flood']);
    expect(setEventEnabled(p, 'flood', true)).toBe(p);  // already on → no-op
    p = setEventEnabled(p, 'flood', false);
    expect(p.events).toEqual([]);
    expect(setEventEnabled(p, 'flood', false)).toBe(p); // already off → no-op
  });
});
