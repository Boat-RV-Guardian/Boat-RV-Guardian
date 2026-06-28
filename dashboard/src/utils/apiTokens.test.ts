import { describe, it, expect } from 'vitest';
import {
  randomToken, maskToken, parseApiTokens, serializeApiTokens, addApiToken, revokeApiToken,
  type ApiToken,
} from './apiTokens';

describe('randomToken', () => {
  it('produces a prefixed hex token of the expected length', () => {
    const t = randomToken(24);
    expect(t).toMatch(/^brvg_[0-9a-f]{48}$/);
  });
  it('is (effectively) unique per call', () => {
    expect(randomToken()).not.toBe(randomToken());
  });
});

describe('maskToken', () => {
  it('keeps the prefix + tail, hiding the middle', () => {
    expect(maskToken('brvg_abcdef0123456789')).toBe('brvg_abcd…6789');
  });
  it('returns short tokens unchanged', () => {
    expect(maskToken('brvg_ab')).toBe('brvg_ab');
  });
});

describe('parse/serialize', () => {
  it('returns [] for blank/corrupt/non-array input', () => {
    expect(parseApiTokens('')).toEqual([]);
    expect(parseApiTokens(null)).toEqual([]);
    expect(parseApiTokens('nope')).toEqual([]);
    expect(parseApiTokens('{"a":1}')).toEqual([]);
  });
  it('drops entries without a token and coerces fields', () => {
    expect(parseApiTokens('[{"token":"t1","label":"HA","createdAt":5},{"label":"x"},{"token":"t2"}]'))
      .toEqual([{ token: 't1', label: 'HA', createdAt: 5 }, { token: 't2', label: '', createdAt: 0 }]);
  });
  it('round-trips', () => {
    const list: ApiToken[] = [{ token: 'brvg_x', label: 'MQTT', createdAt: 10 }];
    expect(parseApiTokens(serializeApiTokens(list))).toEqual(list);
  });
});

describe('add/revoke', () => {
  it('adds with a trimmed label, ignoring duplicates', () => {
    let list: ApiToken[] = [];
    list = addApiToken(list, 'brvg_a', '  Home Assistant  ', 100);
    expect(list).toEqual([{ token: 'brvg_a', label: 'Home Assistant', createdAt: 100 }]);
    expect(addApiToken(list, 'brvg_a', 'dup', 200)).toBe(list); // duplicate token → no-op
  });
  it('defaults a blank label to Untitled', () => {
    expect(addApiToken([], 'brvg_a', '   ', 1)[0].label).toBe('Untitled');
  });
  it('revokes by token value', () => {
    const list: ApiToken[] = [{ token: 'a', label: '', createdAt: 0 }, { token: 'b', label: '', createdAt: 0 }];
    expect(revokeApiToken(list, 'a')).toEqual([{ token: 'b', label: '', createdAt: 0 }]);
    expect(revokeApiToken(list, 'z')).toBe(list); // absent → no-op
  });
});
