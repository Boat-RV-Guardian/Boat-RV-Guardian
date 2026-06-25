import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { useEntitlements } from '../../hooks/useEntitlements';
import { TIER_LABELS, UPGRADE_PORTAL_URL } from '../../utils/entitlements';
import { isTauriEnv } from '../../utils/linktapHttp';

// Compact per-vehicle plan indicator shown inside the Vehicles section: "Plan: <tier>" + an Upgrade
// button to the web billing portal when the active vehicle isn't Premium. The full feature
// comparison lives on the marketing site's pricing page, NOT in the app (per owner, 2026-06-25).

function openExternal(url: string) {
  // Native app → open in the system browser via the shell plugin; web → normal new tab.
  if (isTauriEnv()) shellOpen(url).catch(() => window.open(url, '_blank'));
  else window.open(url, '_blank', 'noopener');
}

export default function PlanBadge() {
  const ent = useEntitlements();
  const isPremium = ent.tier === 'premium';
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', background: 'rgba(0,0,0,0.2)', padding: '10px 14px', borderRadius: '8px' }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
        Plan: <strong style={{ color: '#fff' }}>{TIER_LABELS[ent.tier]}</strong>
      </span>
      {!isPremium && (
        <button className="btn-primary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => openExternal(UPGRADE_PORTAL_URL)}>
          Upgrade →
        </button>
      )}
    </div>
  );
}
