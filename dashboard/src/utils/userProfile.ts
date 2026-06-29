// User registry (2026-06-28). Every signed-in user gets a `users/{uid}` profile doc so the operator
// admin console can see ALL accounts — not just ones that happen to hold vehicle membership. The
// doc shape is built purely (testable); App.tsx does the Firestore read/merge-write on auth change.

export interface LoginUser {
  uid: string;
  email?: string | null;
  displayName?: string | null;
}

export interface UserProfileWrite {
  email: string;
  displayName: string;
  lastLoginAt: number;
  /** Set only on first write (when the user doc didn't exist yet). */
  createdAt?: number;
}

/**
 * Build the `users/{uid}` profile fields to merge-write on login. Email is lowercased to match the
 * member-email convention (rules compare against the lowercased auth token email). `createdAt` is
 * included only when the doc doesn't exist yet, so a returning login doesn't clobber the original.
 */
export function buildLoginProfile(user: LoginUser, exists: boolean, now: number): UserProfileWrite {
  const profile: UserProfileWrite = {
    email: (user.email || '').toLowerCase(),
    displayName: user.displayName || '',
    lastLoginAt: now,
  };
  if (!exists) profile.createdAt = now;
  return profile;
}
