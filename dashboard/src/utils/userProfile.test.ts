import { describe, it, expect } from 'vitest';
import { buildLoginProfile } from './userProfile';

describe('buildLoginProfile', () => {
  it('lowercases email, carries displayName + lastLoginAt', () => {
    const p = buildLoginProfile({ uid: 'u1', email: 'Skipper@Example.COM', displayName: 'Skipper' }, true, 1000);
    expect(p).toEqual({ email: 'skipper@example.com', displayName: 'Skipper', lastLoginAt: 1000 });
  });

  it('sets createdAt only on first write (doc absent)', () => {
    expect(buildLoginProfile({ uid: 'u1', email: 'a@b.c' }, false, 500).createdAt).toBe(500);
    expect(buildLoginProfile({ uid: 'u1', email: 'a@b.c' }, true, 500).createdAt).toBeUndefined();
  });

  it('tolerates missing email/displayName', () => {
    const p = buildLoginProfile({ uid: 'u1' }, false, 1);
    expect(p.email).toBe('');
    expect(p.displayName).toBe('');
  });
});
