import { useState } from 'react';
import { checkDisplayName, saveDisplayName, MAX_DISPLAY_NAME } from '../utils/displayName';

// Inline-editable display name for the Account portal (Task 14). Validation + save orchestration are
// the pure/tested utils/displayName; Firebase Auth + Firestore are lazy-imported in the handler so
// Account.tsx stays Firebase-light. Renders compactly so it can sit in the "Signed in as" value slot.

export default function EditDisplayName({ uid, displayName }: { uid?: string | null; displayName?: string | null }) {
  const [name, setName] = useState<string>(displayName || '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!uid) return <span>{name || '—'}</span>;

  const open = () => { setDraft(name); setMsg(null); setEditing(true); };
  const check = checkDisplayName(draft, name);
  const canSave = check.valid && check.changed && !busy;

  const onSave = async () => {
    if (!check.valid || !check.changed) return;
    setBusy(true);
    setMsg(null);
    try {
      const { auth, db } = await import('../services/firebase');
      const { updateProfile } = await import('firebase/auth');
      const fs = await import('firebase/firestore');
      const res = await saveDisplayName(check.value, {
        updateAuthProfile: (dn) => (auth.currentUser ? updateProfile(auth.currentUser, { displayName: dn }) : Promise.reject(new Error('not signed in'))),
        updateUserDoc: (dn) => fs.setDoc(fs.doc(db, 'users', uid), { displayName: dn }, { merge: true }),
      });
      if (res.ok) { setName(check.value); setEditing(false); }
      else { setMsg(res.error?.includes('recent-login') ? 'Please sign in again, then retry.' : (res.error || 'Could not save.')); }
    } catch (e: any) {
      setMsg(e?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
        <span>{name || '—'}</span>
        <button
          onClick={open}
          style={{ background: 'none', border: '1px solid rgba(255,255,255,0.25)', color: 'var(--accent-cyan)', borderRadius: '6px', padding: '2px 8px', cursor: 'pointer', fontSize: '0.75rem' }}
        >
          Edit
        </button>
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_DISPLAY_NAME}
          aria-label="Display name"
          placeholder="Your name"
          style={{ padding: '5px 8px', borderRadius: '6px', background: 'rgba(0,0,0,0.25)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', fontSize: '0.85rem' }}
        />
        <button
          onClick={onSave}
          disabled={!canSave}
          style={{ background: canSave ? 'var(--accent-cyan)' : 'rgba(255,255,255,0.1)', border: 'none', color: canSave ? '#000' : 'var(--text-secondary)', borderRadius: '6px', padding: '5px 12px', cursor: canSave ? 'pointer' : 'not-allowed', fontSize: '0.8rem' }}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => { setEditing(false); setMsg(null); }} className="btn-secondary" style={{ padding: '5px 10px', fontSize: '0.8rem' }}>Cancel</button>
      </span>
      {!check.valid && check.error && draft.length > 0 && <span style={{ fontSize: '0.72rem', color: '#fca5a5' }}>{check.error}</span>}
      {msg && <span style={{ fontSize: '0.72rem', color: '#fca5a5' }}>{msg}</span>}
    </span>
  );
}
