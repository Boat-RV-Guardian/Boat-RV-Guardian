import { describe, it, expect } from 'vitest';
import { resolveRole, canControl, validateControlCommand, LINKTAP_MAX_DURATION_MINS } from './authz';

describe('resolveRole', () => {
  const members = {
    uOwner: { role: 'admin' },
    uCtrl: { role: 'control' },
    uMon: { role: 'monitor' },
  };
  it('returns the explicit member role', () => {
    expect(resolveRole(members, ['uOwner', 'uCtrl', 'uMon'], 'uOwner')).toBe('admin');
    expect(resolveRole(members, ['uOwner', 'uCtrl', 'uMon'], 'uCtrl')).toBe('control');
    expect(resolveRole(members, ['uOwner', 'uCtrl', 'uMon'], 'uMon')).toBe('monitor');
  });
  it('treats a legacy allowedUsers member with no members entry as admin (original owner)', () => {
    expect(resolveRole({}, ['uLegacy'], 'uLegacy')).toBe('admin');
    expect(resolveRole(null, ['uLegacy'], 'uLegacy')).toBe('admin');
  });
  it('returns null for a user with no access', () => {
    expect(resolveRole(members, ['uOwner'], 'stranger')).toBeNull();
    expect(resolveRole(null, null, 'x')).toBeNull();
    expect(resolveRole(members, ['uOwner'], '')).toBeNull();
  });
  it('ignores a malformed role value and falls through to allowedUsers', () => {
    expect(resolveRole({ u: { role: 'superuser' } }, ['u'], 'u')).toBe('admin'); // junk role → legacy owner path
    expect(resolveRole({ u: { role: 'superuser' } }, [], 'u')).toBeNull();
  });
});

describe('canControl', () => {
  it('allows admin and control', () => {
    expect(canControl('admin')).toBe(true);
    expect(canControl('control')).toBe(true);
  });
  it('denies monitor and no-role', () => {
    expect(canControl('monitor')).toBe(false);
    expect(canControl(null)).toBe(false);
  });
});

describe('validateControlCommand', () => {
  it('always allows close (no limit needed)', () => {
    expect(validateControlCommand({ action: 'close' })).toEqual({ ok: true });
  });
  it('requires a positive duration on open (safety self-limit)', () => {
    expect(validateControlCommand({ action: 'open' }).ok).toBe(false);
    expect(validateControlCommand({ action: 'open', durationSec: 0 }).ok).toBe(false);
    expect(validateControlCommand({ action: 'open', durationSec: -10 }).ok).toBe(false);
    expect(validateControlCommand({ action: 'open', durationSec: NaN }).ok).toBe(false);
  });
  it('normalizes open duration to whole minutes (min 1, capped 1439)', () => {
    expect(validateControlCommand({ action: 'open', durationSec: 600 })).toEqual({ ok: true, durationMins: 10 });
    expect(validateControlCommand({ action: 'open', durationSec: 30 })).toEqual({ ok: true, durationMins: 1 }); // <1min → 1
    expect(validateControlCommand({ action: 'open', durationSec: 999_999 }))
      .toEqual({ ok: true, durationMins: LINKTAP_MAX_DURATION_MINS });
  });
  it('passes through a positive volume limit, ignores a non-positive one', () => {
    expect(validateControlCommand({ action: 'open', durationSec: 600, volumeLimitLiters: 50 }))
      .toEqual({ ok: true, durationMins: 10, vol: 50 });
    expect(validateControlCommand({ action: 'open', durationSec: 600, volumeLimitLiters: 0 }))
      .toEqual({ ok: true, durationMins: 10 });
  });
  it('rejects an unknown action', () => {
    expect(validateControlCommand({ action: 'explode' as any }).ok).toBe(false);
  });
});
