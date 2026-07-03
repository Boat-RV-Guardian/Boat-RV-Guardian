// Email-verification helpers. Email/password sign-ups get a Firebase verification email; Google
// sign-ins are already `emailVerified` so they never need one. Accounts on the test domain are
// exempt so automated/agent testing can create throwaway accounts without a real inbox.

export const EMAIL_VERIFY_EXEMPT_DOMAIN = 'brvg-tests.com';

export function isEmailVerifyExempt(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith('@' + EMAIL_VERIFY_EXEMPT_DOMAIN);
}

interface VerifiableUser {
  email: string | null;
  emailVerified: boolean;
  providerData: { providerId: string }[];
}

/**
 * Whether to nudge the signed-in user to verify their email. True only for a password-based account
 * that hasn't verified yet. Google (and any already-verified) users are excluded because
 * `emailVerified` is true; test-domain accounts are excluded by policy.
 */
export function needsEmailVerification(user: VerifiableUser | null | undefined): boolean {
  if (!user) return false;
  if (user.emailVerified) return false;
  if (isEmailVerifyExempt(user.email)) return false;
  return user.providerData.some((p) => p.providerId === 'password');
}
