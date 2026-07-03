import { describe, it, expect, vi } from 'vitest';
import { validateNewPassword, changePassword, MIN_PASSWORD } from './changePassword';

describe('validateNewPassword', () => {
  it('rejects short passwords', () => {
    expect(validateNewPassword('abc', 'abc')).toMatch(/at least/);
  });
  it('rejects mismatched confirmation', () => {
    expect(validateNewPassword('abcdef1', 'abcdef2')).toMatch(/do not match/);
  });
  it('rejects reusing the current password', () => {
    expect(validateNewPassword('samepass', 'samepass', 'samepass')).toMatch(/differ/);
  });
  it('accepts a valid new password', () => {
    expect(validateNewPassword('newpass1', 'newpass1', 'oldpass')).toBeNull();
    expect('newpass1'.length >= MIN_PASSWORD).toBe(true);
  });
});

describe('changePassword', () => {
  const okDeps = () => ({ reauth: vi.fn().mockResolvedValue(undefined), update: vi.fn().mockResolvedValue(undefined) });

  it('reauths then updates on success', async () => {
    const deps = okDeps();
    const r = await changePassword({ currentPassword: 'old', newPassword: 'brandnew1', confirmPassword: 'brandnew1' }, deps);
    expect(r.ok).toBe(true);
    expect(deps.reauth).toHaveBeenCalledWith('old');
    expect(deps.update).toHaveBeenCalledWith('brandnew1');
  });

  it('does not call firebase when validation fails', async () => {
    const deps = okDeps();
    const r = await changePassword({ currentPassword: 'old', newPassword: 'x', confirmPassword: 'x' }, deps);
    expect(r.ok).toBe(false);
    expect(deps.reauth).not.toHaveBeenCalled();
  });

  it('maps a wrong current password', async () => {
    const deps = { reauth: vi.fn().mockRejectedValue({ code: 'auth/wrong-password' }), update: vi.fn() };
    const r = await changePassword({ currentPassword: 'bad', newPassword: 'brandnew1', confirmPassword: 'brandnew1' }, deps);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/incorrect/);
    expect(deps.update).not.toHaveBeenCalled();
  });

  it('maps a weak new password from the update step', async () => {
    const deps = { reauth: vi.fn().mockResolvedValue(undefined), update: vi.fn().mockRejectedValue({ code: 'auth/weak-password' }) };
    const r = await changePassword({ currentPassword: 'old', newPassword: 'brandnew1', confirmPassword: 'brandnew1' }, deps);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/weak/);
  });
});
