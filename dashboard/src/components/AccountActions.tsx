import { useState } from 'react';
import { isLocalMode } from '../utils/userScope';
import { accountModeLabel } from '../utils/accountMode';

// Identity + mode actions for the Account portal (Task 16 IA — Account is the identity/billing/mode
// home). Shows the device's account mode, a sign-out (when signed in), and a switch-to-cloud entry
// (when local-only). Firebase is lazy-imported so Account.tsx stays Firebase-light, like
// DeleteAccountButton / EditDisplayName.

export default function AccountActions({ user }: { user?: { email?: string | null } | null }) {
  const [busy, setBusy] = useState(false);
  const localMode = isLocalMode(localStorage);
  const signedIn = !!user;

  const onSignOut = async () => {
    setBusy(true);
    try {
      const { auth, signOut } = await import('../services/firebase');
      await signOut(auth);
    } catch { /* ignore — onAuthStateChanged drives the UI */ }
    setBusy(false);
  };

  // The inline Login + local→cloud switch live in Settings → Account (rebuild flow); route there.
  const onSwitchToCloud = () => window.dispatchEvent(new CustomEvent('navigate_view', { detail: 'settings' }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
        <span style={{ color: 'var(--text-secondary)' }}>Mode</span>
        <span>{accountModeLabel(signedIn, localMode)}</span>
      </div>
      {signedIn && (
        <button
          onClick={onSignOut}
          disabled={busy}
          style={{ alignSelf: 'flex-start', background: 'none', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '8px', padding: '6px 14px', cursor: busy ? 'wait' : 'pointer', fontSize: '0.82rem' }}
        >
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      )}
      {localMode && (
        <button onClick={onSwitchToCloud} className="btn-secondary" style={{ alignSelf: 'flex-start', padding: '6px 14px', fontSize: '0.82rem' }}>
          ☁️ Switch to a cloud account
        </button>
      )}
    </div>
  );
}
