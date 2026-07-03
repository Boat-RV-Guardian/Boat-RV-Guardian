import { useState } from 'react';
import { changePassword, MIN_PASSWORD } from '../utils/changePassword';

// Collapsible "change password" for the Account view (Task 14). Only rendered for password-based
// accounts (Google users have no password to change). Firebase Auth is lazy-imported in the handler
// so Account.tsx stays Firebase-light; the pure flow lives in utils/changePassword.
export default function ChangePassword({ email }: { email?: string | null }) {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const reset = () => { setCur(''); setNext(''); setConfirm(''); setMsg(null); setOk(false); };

  const submit = async () => {
    if (!email) { setMsg('No email on this account.'); return; }
    setBusy(true); setMsg(null); setOk(false);
    try {
      const { auth } = await import('../services/firebase');
      const { EmailAuthProvider, reauthenticateWithCredential, updatePassword } = await import('firebase/auth');
      const u = auth.currentUser;
      if (!u) { setMsg('Please sign in again.'); setBusy(false); return; }
      const res = await changePassword(
        { currentPassword: cur, newPassword: next, confirmPassword: confirm },
        {
          reauth: (pw) => reauthenticateWithCredential(u, EmailAuthProvider.credential(email, pw)).then(() => undefined),
          update: (pw) => updatePassword(u, pw),
        },
      );
      if (res.ok) { setOk(true); setMsg('Password updated.'); setCur(''); setNext(''); setConfirm(''); }
      else setMsg(res.error || 'Could not change password.');
    } catch (e: any) {
      setMsg(e?.message || 'Could not change password.');
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <button className="btn-secondary" style={{ alignSelf: 'flex-start', padding: '6px 12px', fontSize: '0.8rem' }}
        onClick={() => { reset(); setOpen(true); }}>Change password</button>
    );
  }

  const field = (label: string, value: string, set: (v: string) => void) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{label}</label>
      <input type="password" value={value} onChange={(e) => set(e.target.value)}
        style={{ padding: '7px 9px', borderRadius: '6px', background: 'rgba(0,0,0,0.25)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', fontSize: '0.85rem' }} />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '340px' }}>
      {field('Current password', cur, setCur)}
      {field(`New password (min ${MIN_PASSWORD})`, next, setNext)}
      {field('Confirm new password', confirm, setConfirm)}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button className="btn-primary" disabled={busy || !cur || next.length < MIN_PASSWORD} onClick={submit}
          style={{ padding: '6px 12px', fontSize: '0.8rem' }}>{busy ? 'Saving…' : 'Update password'}</button>
        <button className="btn-secondary" onClick={() => { setOpen(false); reset(); }}
          style={{ padding: '6px 12px', fontSize: '0.8rem' }}>Cancel</button>
      </div>
      {msg && <span style={{ fontSize: '0.75rem', color: ok ? '#22c55e' : '#fca5a5' }}>{msg}</span>}
    </div>
  );
}
