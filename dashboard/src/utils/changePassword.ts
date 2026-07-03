// Pure orchestration for the Account "change password" flow. Firebase Auth is injected via deps so
// this stays testable and Account.tsx stays Firebase-light (the component lazy-imports firebase and
// supplies the deps). Firebase requires a recent re-authentication before updatePassword, so the flow
// is: validate → reauth with the current password → update to the new one.

export const MIN_PASSWORD = 6;

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface ChangePasswordDeps {
  reauth: (currentPassword: string) => Promise<void>;
  update: (newPassword: string) => Promise<void>;
}

export interface ChangePasswordResult { ok: boolean; error?: string }

/** Client-side validation of the new password. Returns an error string, or null if valid. */
export function validateNewPassword(newPassword: string, confirmPassword: string, currentPassword?: string): string | null {
  if (newPassword.length < MIN_PASSWORD) return `New password must be at least ${MIN_PASSWORD} characters.`;
  if (newPassword !== confirmPassword) return 'New passwords do not match.';
  if (currentPassword != null && newPassword === currentPassword) return 'New password must differ from the current one.';
  return null;
}

function mapCode(code: string, message: string): string {
  if (code.includes('wrong-password') || code.includes('invalid-credential')) return 'Current password is incorrect.';
  if (code.includes('too-many-requests')) return 'Too many attempts — please try again later.';
  if (code.includes('weak-password')) return 'New password is too weak.';
  if (code.includes('requires-recent-login')) return 'For security, please sign out and back in, then retry.';
  return message || 'Could not change password.';
}

export async function changePassword(input: ChangePasswordInput, deps: ChangePasswordDeps): Promise<ChangePasswordResult> {
  const v = validateNewPassword(input.newPassword, input.confirmPassword, input.currentPassword);
  if (v) return { ok: false, error: v };
  try {
    await deps.reauth(input.currentPassword);
  } catch (e: any) {
    return { ok: false, error: mapCode(e?.code || '', e?.message) };
  }
  try {
    await deps.update(input.newPassword);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: mapCode(e?.code || '', e?.message) };
  }
}
