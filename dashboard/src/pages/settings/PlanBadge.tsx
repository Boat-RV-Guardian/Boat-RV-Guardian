import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { useEntitlements } from '../../hooks/useEntitlements';
import { TIER_LABELS, UPGRADE_PORTAL_URL } from '../../utils/entitlements';
import { isTauriEnv } from '../../utils/linktapHttp';

// Compact per-vehicle plan indicator (Settings → Vehicles): "Plan: <tier>" + a Manage/Upgrade button.
// Subscription/billing is a WEB experience (autofill works in a real browser, not the native
// WKWebView), so on the native app the button opens the web portal in the system browser; on the web
// build it just routes to the in-app Account view (already a browser).
function openPortal() {
  if (isTauriEnv()) shellOpen(UPGRADE_PORTAL_URL).catch(() => window.open(UPGRADE_PORTAL_URL, '_blank'));
  else window.dispatchEvent(new CustomEvent('navigate_view', { detail: 'account' }));
}

export default function PlanBadge() {
  const ent = useEntitlements();
  const isPremium = ent.tier === 'premium';
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', background: 'rgba(0,0,0,0.2)', padding: '10px 14px', borderRadius: '8px' }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
        Plan: <strong style={{ color: '#fff' }}>{TIER_LABELS[ent.tier]}</strong>
      </span>
      <button className="btn-primary" style={{ padding: '6px 12px', fontSize: '0.8rem', whiteSpace: 'nowrap' }} onClick={openPortal}>
        {isPremium ? 'Manage plan →' : 'Upgrade →'}
      </button>
    </div>
  );
}
