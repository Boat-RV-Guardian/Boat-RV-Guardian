import { useState } from 'react';
import { useEntitlements } from '../hooks/useEntitlements';
import { entitlementSummary, TIER_LABELS, TIER_PRICING } from '../utils/entitlements';
import { redeemCoupon, MOCK_COUPONS } from '../utils/billing';

// In-app subscription portal (open-tasks Task 14). MOCK billing for now: a coupon code "purchases" a
// tier for the active vehicle so the entitlement flow is testable before Stripe. The Upgrade button
// in Settings → Vehicles routes here.
export default function Account() {
  const ent = useEntitlements();
  const price = TIER_PRICING[ent.tier];
  const rows = entitlementSummary(ent);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = () => {
    const r = redeemCoupon(code);
    setMsg(r.ok ? { ok: true, text: `✓ Applied — this vehicle is now ${TIER_LABELS[r.tier!]}.` } : { ok: false, text: r.error || 'Failed' });
    if (r.ok) setCode('');
  };

  return (
    <div style={{ padding: '20px', maxWidth: '720px', margin: '0 auto', color: '#fff', paddingBottom: '100px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <h2 style={{ fontSize: '2rem', color: 'var(--accent-cyan)', margin: 0 }}>Account &amp; Plan</h2>

      {/* Current plan */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
          <span style={{ fontSize: '1.6rem', fontWeight: 700 }}>{TIER_LABELS[ent.tier]}</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {price.monthly > 0 ? `$${price.monthly}/mo · $${price.yearly}/yr` : 'Free'}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: '#f59e0b', border: '1px solid #f59e0b', borderRadius: '999px', padding: '2px 8px' }}>MOCK BILLING</span>
        </div>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
          Plans are per vehicle — people you share this vehicle with get its features. Real payments
          aren't live yet; use a coupon code below to change the plan for testing.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
          {rows.map((r) => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                <span style={{ color: r.on ? '#22c55e' : '#6b7280', marginRight: '8px' }}>{r.on ? '✓' : '○'}</span>{r.label}
              </span>
              <span style={{ color: r.on ? '#fff' : 'var(--text-secondary)' }}>{r.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Coupon redemption (mock payment) */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <h3 style={{ margin: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>Redeem a code</h3>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Enter a coupon to change this vehicle's plan (stand-in for the credit-card checkout, coming later).
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input className="form-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Coupon code" autoCapitalize="characters" autoCorrect="off" spellCheck={false} style={{ flex: 1 }} onKeyDown={(e) => { if (e.key === 'Enter') apply(); }} />
          <button className="btn-primary" onClick={apply} disabled={!code.trim()} style={{ padding: '8px 18px' }}>Apply</button>
        </div>
        {msg && <p style={{ margin: 0, fontSize: '0.82rem', color: msg.ok ? '#22c55e' : '#ffb3b3' }}>{msg.text}</p>}
        <p style={{ margin: '4px 0 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          Test codes: {Object.keys(MOCK_COUPONS).join(' · ')}
        </p>
      </div>
    </div>
  );
}
