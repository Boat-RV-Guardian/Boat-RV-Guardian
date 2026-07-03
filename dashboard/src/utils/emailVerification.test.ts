import { describe, it, expect } from 'vitest';
import { isEmailVerifyExempt, needsEmailVerification } from './emailVerification';

const pw = (over: Partial<{ email: string | null; emailVerified: boolean }> = {}) => ({
  email: 'user@example.com', emailVerified: false, providerData: [{ providerId: 'password' }], ...over,
});
const google = (over: Partial<{ email: string | null; emailVerified: boolean }> = {}) => ({
  email: 'user@gmail.com', emailVerified: true, providerData: [{ providerId: 'google.com' }], ...over,
});

describe('isEmailVerifyExempt', () => {
  it('exempts the test domain (case-insensitive)', () => {
    expect(isEmailVerifyExempt('bot@brvg-tests.com')).toBe(true);
    expect(isEmailVerifyExempt('Bot@BRVG-Tests.com')).toBe(true);
  });
  it('does not exempt real domains or blanks', () => {
    expect(isEmailVerifyExempt('user@example.com')).toBe(false);
    expect(isEmailVerifyExempt('user@brvg-tests.com.evil.com')).toBe(false);
    expect(isEmailVerifyExempt(null)).toBe(false);
    expect(isEmailVerifyExempt('')).toBe(false);
  });
});

describe('needsEmailVerification', () => {
  it('nudges an unverified password account', () => {
    expect(needsEmailVerification(pw())).toBe(true);
  });
  it('skips verified password accounts', () => {
    expect(needsEmailVerification(pw({ emailVerified: true }))).toBe(false);
  });
  it('skips Google accounts (already verified)', () => {
    expect(needsEmailVerification(google())).toBe(false);
  });
  it('skips the test domain even when unverified', () => {
    expect(needsEmailVerification(pw({ email: 'bot@brvg-tests.com' }))).toBe(false);
  });
  it('skips null / signed-out', () => {
    expect(needsEmailVerification(null)).toBe(false);
    expect(needsEmailVerification(undefined)).toBe(false);
  });
  it('does not nudge a passwordless (federated-only) unverified user', () => {
    expect(needsEmailVerification({ email: 'x@y.com', emailVerified: false, providerData: [{ providerId: 'google.com' }] })).toBe(false);
  });
});
