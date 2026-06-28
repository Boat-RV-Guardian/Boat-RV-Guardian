import { describe, it, expect } from 'vitest';
import {
  historyRetentionDaysForTier,
  isTrialExpired,
  retentionCutoffMonth,
  monthFromHistoryId,
  historyDocsToPrune,
  HISTORY_RETENTION_DAYS,
} from './retention';

// A fixed "now" so month math is deterministic: 2026-06-27T00:00:00Z.
const NOW = Date.UTC(2026, 5, 27);

describe('historyRetentionDaysForTier', () => {
  it('maps known tiers', () => {
    expect(historyRetentionDaysForTier('free')).toBe(0);
    expect(historyRetentionDaysForTier('basic')).toBe(30);
    expect(historyRetentionDaysForTier('premium')).toBe(1095);
  });
  it('grandfathers legacy/unknown tiers to premium (keep all)', () => {
    expect(historyRetentionDaysForTier(null)).toBe(HISTORY_RETENTION_DAYS.premium);
    expect(historyRetentionDaysForTier(undefined)).toBe(HISTORY_RETENTION_DAYS.premium);
    expect(historyRetentionDaysForTier('gold')).toBe(HISTORY_RETENTION_DAYS.premium);
  });
});

describe('isTrialExpired', () => {
  it('is expired when trialEndsAt is in the past', () => {
    expect(isTrialExpired(NOW - 1, NOW)).toBe(true);
  });
  it('is not expired when the trial is still running or ends exactly now', () => {
    expect(isTrialExpired(NOW + 86_400_000, NOW)).toBe(false);
    expect(isTrialExpired(NOW, NOW)).toBe(false); // boundary: not yet past
  });
  it('treats missing / non-positive / non-finite markers as "no active trial"', () => {
    expect(isTrialExpired(null, NOW)).toBe(false);
    expect(isTrialExpired(undefined, NOW)).toBe(false);
    expect(isTrialExpired(0, NOW)).toBe(false);
    expect(isTrialExpired(-5, NOW)).toBe(false);
    expect(isTrialExpired(NaN, NOW)).toBe(false);
  });
});

describe('retentionCutoffMonth', () => {
  it('returns empty (keep nothing) for a zero/negative window', () => {
    expect(retentionCutoffMonth(NOW, 0)).toBe('');
    expect(retentionCutoffMonth(NOW, -1)).toBe('');
  });
  it('computes the cutoff month for a positive window', () => {
    // 30 days before 2026-06-27 = 2026-05-28 → month 2026-05.
    expect(retentionCutoffMonth(NOW, 30)).toBe('2026-05');
    // ~3 years back → 2023-06.
    expect(retentionCutoffMonth(NOW, 1095)).toBe('2023-06');
  });
});

describe('monthFromHistoryId', () => {
  it('extracts the trailing YYYY-MM', () => {
    expect(monthFromHistoryId('shellyfloodg4-d885acea3914_2026-06')).toBe('2026-06');
    expect(monthFromHistoryId('dev_with_underscores_2025-12')).toBe('2025-12');
  });
  it('returns null when no month suffix is present', () => {
    expect(monthFromHistoryId('weird-doc-id')).toBeNull();
    expect(monthFromHistoryId('2026-06-extra')).toBeNull();
  });
});

describe('historyDocsToPrune', () => {
  const ids = [
    'devA_2023-01', // very old
    'devA_2026-05', // = cutoff month for 30d → kept
    'devA_2026-06', // current → kept
    'mystery-doc',  // unparseable → never pruned
  ];

  it('prunes everything for a zero window (free tier: on-device only)', () => {
    expect(historyDocsToPrune(ids, 0, NOW).sort()).toEqual(
      ['devA_2023-01', 'devA_2026-05', 'devA_2026-06', 'mystery-doc'].sort(),
    );
  });

  it('prunes only months strictly older than the cutoff (basic ~30d)', () => {
    // cutoff month = 2026-05; only 2023-01 is older. 2026-05 (cutoff) and 2026-06 are kept.
    expect(historyDocsToPrune(ids, 30, NOW)).toEqual(['devA_2023-01']);
  });

  it('keeps everything dated within a long window (premium ~3y)', () => {
    // cutoff = 2023-06; 2023-01 is older → pruned; rest kept.
    expect(historyDocsToPrune(ids, 1095, NOW)).toEqual(['devA_2023-01']);
  });

  it('never prunes a doc id without a parseable month', () => {
    expect(historyDocsToPrune(['mystery-doc'], 30, NOW)).toEqual([]);
  });
});
