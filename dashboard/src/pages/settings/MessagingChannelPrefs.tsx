// Reusable per-vehicle messaging-channel prefs editor (Premium). One instance per channel — SMS,
// WhatsApp, Telegram — each backed by its own synced `sh_*_prefs` field. The channels share the
// SmsPrefs shape ({phones = generic address list, events}); the cloud-server reads the same shape
// (see brvg-cloud-server messaging.ts parseMessagingPrefs). 'phone' variant validates/normalizes to
// E.164; 'handle' variant (Telegram) accepts a freeform chat id / @username.

import { useState } from 'react';
import { addPhone, addHandle, removePhone, setEventEnabled, SMS_EVENT_CATALOG, type SmsPrefs } from '../../utils/smsPrefs';

interface Props {
  title: string;
  /** Shown when the tier can't use this channel. */
  lockedNote: string;
  /** Shown above the inputs when unlocked. */
  description: string;
  unlocked: boolean;
  prefs: SmsPrefs;
  onChange: (next: SmsPrefs) => void;
  variant: 'phone' | 'handle';
  inputPlaceholder: string;
  /** Label for the address chips area ("No numbers yet." / "No chats yet."). */
  emptyLabel: string;
}

export default function MessagingChannelPrefs({
  title, lockedNote, description, unlocked, prefs, onChange, variant, inputPlaceholder, emptyLabel,
}: Props) {
  const [input, setInput] = useState('');
  const [err, setErr] = useState('');

  const onAdd = () => {
    const next = variant === 'phone' ? addPhone(prefs, input) : addHandle(prefs, input);
    if (next === prefs) { setErr(input.trim() ? 'Enter a valid destination.' : ''); return; }
    onChange(next);
    setInput('');
    setErr('');
  };

  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <h3 style={{ margin: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>
        {title}{!unlocked && ' (Premium)'}
      </h3>
      {!unlocked ? (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>{lockedNote}</p>
      ) : (
        <>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>{description}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {prefs.phones.map((p) => (
              <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '14px', padding: '4px 10px', fontSize: '0.82rem' }}>
                {p}
                <button onClick={() => onChange(removePhone(prefs, p))} aria-label={`Remove ${p}`} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: 0 }}>×</button>
              </span>
            ))}
            {prefs.phones.length === 0 && (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{emptyLabel}</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type={variant === 'phone' ? 'tel' : 'text'}
              value={input}
              onChange={(e) => { setInput(e.target.value); setErr(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') onAdd(); }}
              placeholder={inputPlaceholder}
              style={{ flex: '1 1 180px', padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: '#fff' }}
            />
            <button className="btn-primary" onClick={onAdd} style={{ padding: '8px 18px' }}>Add</button>
          </div>
          {err && <span style={{ fontSize: '0.78rem', color: 'var(--accent-red, #ff6b6b)' }}>{err}</span>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
            {SMS_EVENT_CATALOG.map((ev) => (
              <label key={ev.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={prefs.events.includes(ev.key)}
                  onChange={(e) => onChange(setEventEnabled(prefs, ev.key, e.target.checked))}
                />
                {ev.label}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
