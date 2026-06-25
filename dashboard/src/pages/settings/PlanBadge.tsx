import { useEntitlements } from '../../hooks/useEntitlements';
import { TIER_LABELS } from '../../utils/entitlements';

// Compact per-vehicle plan indicator shown inside the Vehicles section: "Plan: <tier>" + an Upgrade
// button (when not Premium) that opens the in-app Account/plan view. The full feature comparison
// lives on the marketing site's pricing page, NOT in the app (per owner, 2026-06-25).

export default function PlanBadge() {
  const ent = useEntitlements();
  const isPremium = ent.tier === 'premium';
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', background: 'rgba(0,0,0,0.2)', padding: '10px 14px', borderRadius: '8px' }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
        Plan: <strong style={{ color: '#fff' }}>{TIER_LABELS[ent.tier]}</strong>
      </span>
      {!isPremium && (
        <button className="btn-primary" style={{ padding: '6px 12px', fontSize: '0.8rem' }}
          onClick={() => window.dispatchEvent(new CustomEvent('navigate_view', { detail: 'account' }))}>
          Upgrade →
        </button>
      )}
    </div>
  );
}
