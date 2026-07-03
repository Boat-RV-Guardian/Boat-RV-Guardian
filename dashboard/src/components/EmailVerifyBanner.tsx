import { useState } from 'react';
import { sendEmailVerification } from '../services/firebase';
import { needsEmailVerification } from '../utils/emailVerification';

// A non-blocking nudge shown to signed-in password users who haven't verified their email. Google
// users (already verified) and test-domain accounts never see it (see needsEmailVerification).
export default function EmailVerifyBanner({ user }: { user: any }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [sent, setSent] = useState(false);

  if (!needsEmailVerification(user)) return null;

  const resend = async () => {
    setBusy(true); setMsg('');
    try {
      await sendEmailVerification(user);
      setSent(true);
      setMsg('Verification email sent — check your inbox, then reload the app.');
    } catch (e: any) {
      setMsg(e?.message || 'Could not send the email. Try again shortly.');
    } finally { setBusy(false); }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
      padding: '8px 20px', background: 'rgba(251,191,36,0.12)',
      borderBottom: '1px solid rgba(251,191,36,0.35)', fontSize: '0.85rem', color: '#fde68a', flexShrink: 0,
    }}>
      <span>📧 Verify your email (<strong>{user.email}</strong>) to secure your account.</span>
      <button
        className="btn-secondary"
        onClick={resend}
        disabled={busy || sent}
        style={{ padding: '4px 10px', fontSize: '0.78rem' }}
      >{sent ? 'Sent ✓' : (busy ? '…' : 'Resend')}</button>
      {msg && <span style={{ color: 'var(--text-secondary)' }}>{msg}</span>}
    </div>
  );
}
