import { useEntitlements } from '../../hooks/useEntitlements';
import { entitlementSummary, TIER_LABELS, TIER_PRICING } from '../../utils/entitlements';

// Read-only "plan" panel for the active vehicle (open-tasks Task 6). Surfaces the per-vehicle tier +
// what it unlocks, reading the entitlement matrix. This is the first real consumer of
// useEntitlements and the foundation for the (deferred) pricing/upgrade flow. No gating happens here.
//
// During the scaffold phase, vehicles with no `tier` field grandfather to Premium (GRANDFATHERED_TIER),
// so this shows "Premium" until billing assigns real tiers.
export default function SubscriptionPanel() {
  const ent = useEntitlements();
  const price = TIER_PRICING[ent.tier];
  const rows = entitlementSummary(ent);

  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <h3 style={{ marginTop: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', margin: 0 }}>
        Plan
      </h3>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
        <span style={{ fontSize: '1.4rem', fontWeight: 700, color: '#fff' }}>{TIER_LABELS[ent.tier]}</span>
        {price.monthly > 0 && (
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            ${price.monthly}/mo · ${price.yearly}/yr
          </span>
        )}
      </div>

      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
        Plans are per vehicle — people you share this vehicle with get its features. Billing isn't live
        yet; managed plans are coming soon.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {rows.map((r) => (
          <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>
              <span style={{ color: r.on ? '#22c55e' : '#6b7280', marginRight: '8px' }}>{r.on ? '✓' : '○'}</span>
              {r.label}
            </span>
            <span style={{ color: r.on ? '#fff' : 'var(--text-secondary)' }}>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
