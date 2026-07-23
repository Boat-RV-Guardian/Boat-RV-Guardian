import { useState } from 'react';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { useEntitlements } from '../../hooks/useEntitlements';
import { TIER_LABELS, UPGRADE_PORTAL_URL } from '../../utils/entitlements';
import { isTauriEnv } from '../../utils/linktapHttp';

// Compact per-vehicle plan indicator (Settings → Vehicles): "Plan: <tier>" + a Manage/Upgrade button.
// Billing is a WEB experience (autofill fails in the native webview) and is scoped to ONE vehicle, so
// the portal link carries the active vehicle id. Desktop/web open it directly; on an app-store native
// build we must NOT link out to external subscription payment, so the button explains inline instead.

function portalUrl(): string {
  const vid = localStorage.getItem('lt_active_vehicle_id') || '';
  return `${UPGRADE_PORTAL_URL}?vehicleId=${encodeURIComponent(vid)}`;
}

function openPortal() {
  const url = portalUrl();
  if (isTauriEnv()) shellOpen(url).catch(() => window.open(url, '_blank'));
  else window.open(url, '_blank');
}

// Capacitor (iOS/Android app-store builds) — NOT Tauri desktop, which may link out freely.
const isMobileNative = () =>
  typeof (window as any).Capacitor !== 'undefined' && !!(window as any).Capacitor.isNativePlatform?.();

export default function PlanBadge() {
  const ent = useEntitlements();
  // Inline note rather than alert(): native webviews swallow window.alert/confirm (see CLAUDE.md).
  const [showNote, setShowNote] = useState(false);
  const isPremium = ent.tier === 'premium';

  // Billing belongs to whoever administers the vehicle; monitors/controllers don't see it.
  const role = localStorage.getItem('lt_my_role') || 'admin';
  if (role !== 'admin') return null;

  const native = isMobileNative();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '10px 14px', borderRadius: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          Plan: <strong style={{ color: '#fff' }}>{TIER_LABELS[ent.tier]}</strong>
        </span>
        <button
          className="btn-primary"
          style={{ padding: '6px 12px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
          onClick={native ? () => setShowNote((s) => !s) : openPortal}
        >
          {isPremium ? 'Manage plan →' : 'Upgrade →'}
        </button>
      </div>
      {native && showNote && (
        <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
          Manage your plan at <strong style={{ color: '#fff' }}>account.boatrvguardian.com</strong> in a web
          browser. App-store rules don't allow linking to outside subscription payment from inside the app.
        </p>
      )}
    </div>
  );
}
