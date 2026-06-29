import { describe, it, expect, vi } from 'vitest';
import { checkDisplayName, saveDisplayName, MAX_DISPLAY_NAME } from './displayName';

describe('checkDisplayName', () => {
  it('rejects empty / whitespace-only input', () => {
    expect(checkDisplayName('').valid).toBe(false);
    expect(checkDisplayName('   ').valid).toBe(false);
    expect(checkDisplayName('   ').error).toMatch(/empty/i);
  });

  it('trims and collapses internal whitespace', () => {
    expect(checkDisplayName('  Skipper   Joe  ').value).toBe('Skipper Joe');
  });

  it('rejects names longer than the budget', () => {
    const r = checkDisplayName('a'.repeat(MAX_DISPLAY_NAME + 1));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/or fewer/i);
  });

  it('accepts a name exactly at the budget', () => {
    expect(checkDisplayName('a'.repeat(MAX_DISPLAY_NAME)).valid).toBe(true);
  });

  it('marks unchanged when it matches the current name (after normalization)', () => {
    const r = checkDisplayName('  Skipper Joe ', 'Skipper Joe');
    expect(r.valid).toBe(true);
    expect(r.changed).toBe(false);
  });

  it('marks changed for a real edit', () => {
    const r = checkDisplayName('First Mate', 'Skipper Joe');
    expect(r.valid).toBe(true);
    expect(r.changed).toBe(true);
  });
});

describe('saveDisplayName', () => {
  it('updates the auth profile then mirrors to the registry doc', async () => {
    const updateAuthProfile = vi.fn().mockResolvedValue(undefined);
    const updateUserDoc = vi.fn().mockResolvedValue(undefined);
    const res = await saveDisplayName('First Mate', { updateAuthProfile, updateUserDoc });
    expect(res.ok).toBe(true);
    expect(updateAuthProfile).toHaveBeenCalledWith('First Mate');
    expect(updateUserDoc).toHaveBeenCalledWith('First Mate');
  });

  it('surfaces an auth-profile failure and does NOT touch the registry', async () => {
    const updateAuthProfile = vi.fn().mockRejectedValue(new Error('auth/requires-recent-login'));
    const updateUserDoc = vi.fn().mockResolvedValue(undefined);
    const res = await saveDisplayName('First Mate', { updateAuthProfile, updateUserDoc });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/recent-login/);
    expect(updateUserDoc).not.toHaveBeenCalled();
  });

  it('treats a registry-mirror failure as non-fatal', async () => {
    const updateAuthProfile = vi.fn().mockResolvedValue(undefined);
    const updateUserDoc = vi.fn().mockRejectedValue(new Error('offline'));
    const res = await saveDisplayName('First Mate', { updateAuthProfile, updateUserDoc });
    expect(res.ok).toBe(true);
  });
});
