import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { useEntitlements } from '../../hooks/useEntitlements';
import { TIER_LABELS } from '../../utils/entitlements';
import { isTauriEnv } from '../../utils/linktapHttp';

function openPortal() {
  const vid = localStorage.getItem('lt_active_vehicle_id') || '';
  const url = `https://account.boatrvguardian.com/?vehicleId=${vid}`;
  if (isTauriEnv()) shellOpen(url).catch(() => window.open(url, '_blank'));
  else window.open(url, '_blank');
}

export default function PlanBadge() {
  const ent = useEntitlements();
  const isPremium = ent.tier === 'premium';
  
  // Hide completely if the user is not the admin/owner of this vehicle
  const role = localStorage.getItem('lt_my_role') || 'admin';
  if (role !== 'admin') return null;

  // App Store policies strictly prohibit external links to digital subscription payments.
  // We hide the button on iOS/Android native builds ("Netflix route") to prevent app rejection.
  const isMobileNative = typeof (window as any).Capacitor !== 'undefined' && (window as any).Capacitor.isNativePlatform?.();

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', background: 'rgba(0,0,0,0.2)', padding: '10px 14px', borderRadius: '8px' }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
        Plan: <strong style={{ color: '#fff' }}>{TIER_LABELS[ent.tier]}</strong>
      </span>
      {!isMobileNative && (
        <button className="btn-primary" style={{ padding: '6px 12px', fontSize: '0.8rem', whiteSpace: 'nowrap' }} onClick={openPortal}>
          {isPremium ? 'Manage plan →' : 'Upgrade →'}
        </button>
      )}
    </div>
  );
}
