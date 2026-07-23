import { useState } from 'react';
import { useEntitlements } from '../hooks/useEntitlements';
import { TIER_LABELS } from '../utils/entitlements';

import { trialStatus, vehiclePlanRows } from '../utils/accountSummary';


import {
  parseApiTokens, serializeApiTokens, addApiToken, revokeApiToken, randomToken, maskToken,
  type ApiToken,
} from '../utils/apiTokens';
import { requestTrial } from '../utils/trial';
import DeleteAccountButton from '../components/DeleteAccountButton';

// Read the local device list / vehicle map straight from localStorage instead of importing
// VehicleManager — that module drags a heavy transitive graph (configSync, etc.) into this view for
// what is just two count reads. Shapes: lt_devices = DeviceConfig[], lt_vehicles = Record<id, …>.
interface LocalDevice { id: string; name?: string; linktapDeviceId?: string }
function readLocalJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; }
}



// In-app subscription portal (open-tasks Task 14). MOCK billing for now: a coupon code "purchases" a
// tier for the active vehicle so the entitlement flow is testable before Stripe. The Upgrade button
// in Settings → Vehicles routes here. Also surfaces trial status, usage-vs-plan, and (Premium) a
// CSV export of on-device usage history.
export default function Account({ user }: { user?: { uid?: string; email?: string | null; displayName?: string | null; emailVerified?: boolean; providerData?: { providerId: string }[] } | null }) {
  const ent = useEntitlements();



  // Integration API tokens (Premium, per-vehicle). Persisted to the synced `sh_api_tokens` field.
  const [apiTokens, setApiTokens] = useState<ApiToken[]>(() => parseApiTokens(localStorage.getItem('sh_api_tokens')));
  const [tokenLabel, setTokenLabel] = useState('');
  const persistTokens = (next: ApiToken[]) => {
    setApiTokens(next);
    localStorage.setItem('sh_api_tokens', serializeApiTokens(next));
    window.dispatchEvent(new Event('settings_updated'));
  };
  const onGenerateToken = () => {
    persistTokens(addApiToken(apiTokens, randomToken(), tokenLabel, Date.now()));
    setTokenLabel('');
  };


  const trial = trialStatus(Number(localStorage.getItem('lt_vehicle_trial_ends')) || null, Date.now());
  const devices = readLocalJson<LocalDevice[]>('lt_devices', []);
  // Per-vehicle plans ("Plex" billing) — read straight from the local vehicle map (each carries its
  // synced `tier`); no heavy VehicleManager import for what is a read-only list.
  const planRows = vehiclePlanRows(
    readLocalJson<Record<string, { config?: Record<string, string> }>>('lt_vehicles', {}),
    localStorage.getItem('lt_active_vehicle_id'),
  );



  // In-portal vehicle switcher (Task 14 remainder): lazy-import VehicleManager, same pattern already
  // used by DeleteAccountButton/EditDisplayName for Firebase, so this view's static import surface
  // stays free of VehicleManager's heavy transitive graph (see the readLocalJson comment above) — it's
  // only pulled in if the user actually clicks Switch. `switchVehicle` writes `lt_active_vehicle_id` +
  // rehydrates the synced settings keys, then dispatches `settings_updated`, which `useEntitlements`
  // (and therefore this whole view) already re-renders on.
  const [switchingVid, setSwitchingVid] = useState<string | null>(null);
  const onSwitchVehicle = async (vid: string) => {
    setSwitchingVid(vid);
    try {
      const { switchVehicle } = await import('../utils/VehicleManager');
      switchVehicle(vid);
    } finally {
      setSwitchingVid(null);
    }
  };

  // Opt-in Basic free trial (owner decision: NOT auto-granted). The worker enforces the real
  // per-user/per-vehicle anti-abuse rule and writes tier='basic' + trialEndsAt; the resulting cloud
  // snapshot flows back via SyncModal → tier_updated, which re-renders this view with the new tier.
  const [trialBusy, setTrialBusy] = useState(false);
  const [trialMsg, setTrialMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const onStartTrial = async () => {
    const vid = localStorage.getItem('lt_active_vehicle_id');
    if (!vid) { setTrialMsg({ ok: false, text: 'Select a vehicle first.' }); return; }
    setTrialBusy(true);
    setTrialMsg(null);
    const r = await requestTrial(vid);
    setTrialBusy(false);
    if (r.granted) {
      // Optimistically reflect the grant so the UI flips to Basic immediately instead of waiting for
      // the cloud snapshot to round-trip back through SyncModal (which still re-confirms it).
      localStorage.setItem('lt_vehicle_tier', r.tier || 'basic');
      if (r.trialEndsAt) localStorage.setItem('lt_vehicle_trial_ends', String(r.trialEndsAt));
      window.dispatchEvent(new Event('tier_updated'));
      setTrialMsg({ ok: true, text: '✓ Your 30-day Basic trial has started.' });
    } else {
      setTrialMsg({ ok: false, text: r.reason ? 'This vehicle isn’t eligible for a trial.' : (r.error || 'Could not start the trial.') });
    }
  };


  return (
    <div style={{ padding: '20px', maxWidth: '720px', margin: '0 auto', color: '#fff', paddingBottom: '100px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Opt-in Basic free trial — only for a signed-in user on a Free vehicle that hasn't trialed yet.
          The worker still enforces eligibility, so this is the offer, not the authorization. */}
      {user?.uid && ent.tier === 'free' && trial.state === 'none' && (
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderColor: '#22c55e55' }}>
          <h3 style={{ margin: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>Try Basic free for 30 days</h3>
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            Start a one-month Basic trial for this vehicle — automatic remote view, remote control,
            away push, cloud flood-shutoff fallback, and ~1 month of history. No card required.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button className="btn-primary" onClick={onStartTrial} disabled={trialBusy} style={{ padding: '8px 18px', opacity: trialBusy ? 0.6 : 1 }}>
              {trialBusy ? 'Starting…' : 'Start free trial'}
            </button>
            {trialMsg && <span style={{ fontSize: '0.82rem', color: trialMsg.ok ? '#22c55e' : '#ffb3b3' }}>{trialMsg.text}</span>}
          </div>
        </div>
      )}

      {/* Trial status (Task 14) — only when a trial marker is present */}
      {trial.state !== 'none' && (
        <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '10px', borderColor: trial.state === 'active' ? '#22c55e55' : '#f59e0b55' }}>
          <span style={{ fontSize: '1.3rem' }}>{trial.state === 'active' ? '⏳' : '⌛'}</span>
          <span style={{ fontSize: '0.9rem' }}>
            {trial.state === 'active'
              ? <>Basic trial active — <strong>{trial.daysLeft} day{trial.daysLeft === 1 ? '' : 's'} left</strong>. Redeem a plan to keep these features.</>
              : <>Your Basic trial has ended. This vehicle reverts to Free unless a plan is active.</>}
          </span>
        </div>
      )}



      {/* Per-vehicle plans (Task 14 "Plex" billing) — read-only overview of every vehicle's tier */}
      {planRows.length > 1 && (
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <h3 style={{ margin: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>Your vehicles &amp; plans</h3>
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            Plans are per vehicle. Switch below to manage another one's plan here (or via Settings → Vehicles).
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
            {planRows.map((r) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span>
                  {r.name}
                  {r.active && <span style={{ marginLeft: '8px', fontSize: '0.7rem', color: 'var(--accent-cyan)', border: '1px solid var(--accent-cyan)', borderRadius: '999px', padding: '1px 7px' }}>active</span>}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{TIER_LABELS[r.tier]}</span>
                  {!r.active && (
                    <button
                      className="btn-secondary"
                      onClick={() => onSwitchVehicle(r.id)}
                      disabled={switchingVid === r.id}
                      style={{ fontSize: '0.75rem', padding: '3px 10px', opacity: switchingVid === r.id ? 0.6 : 1 }}
                    >
                      {switchingVid === r.id ? 'Switching…' : 'Switch'}
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Data & privacy (GDPR) */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <h3 style={{ margin: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>Data &amp; privacy</h3>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            Manage your data and export GDPR reports via our secure web portal.
          </span>
          <button className="btn-primary" onClick={() => window.open('https://account.boatrvguardian.com/', '_blank')} style={{ padding: '8px 18px' }}>
            Privacy Portal
          </button>
        </div>

        {/* Delete account (GDPR) — only when signed in. Solo-owned vehicles are deleted; shared ones
            you're simply removed from. Shared, confirm-protected component (also in Settings → Danger Zone). */}
        {user?.uid && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '10px', marginTop: '4px' }}>
            <DeleteAccountButton uid={user.uid} />
          </div>
        )}
      </div>


      {/* Integrations / API tokens (Task 14) — Premium (canIntegrations). Scaffold: tokens are issued
          + stored + synced; no server validates them yet (lands with the integration endpoints). */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <h3 style={{ margin: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>
          Integrations &amp; API tokens{!ent.canIntegrations && ' (Premium)'}
        </h3>
        {!ent.canIntegrations ? (
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
            Issue API tokens for Home Assistant, MQTT, or webhooks. Upgrade to Premium to create tokens.
          </p>
        ) : (
          <>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
              Create a token for an external integration. Copy it now — store it in your integration's
              config. (Validation goes live with the integration endpoints.)
            </p>
            {apiTokens.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {apiTokens.map((t) => (
                  <div key={t.token} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.82rem', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <span style={{ flex: '1 1 auto' }}>{t.label}</span>
                    <code style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{maskToken(t.token)}</code>
                    <button onClick={() => persistTokens(revokeApiToken(apiTokens, t.token))} className="btn-secondary" style={{ padding: '4px 12px', fontSize: '0.78rem' }}>Revoke</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                value={tokenLabel}
                onChange={(e) => setTokenLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onGenerateToken(); }}
                placeholder="Label (e.g. Home Assistant)"
                style={{ flex: '1 1 180px', padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: '#fff' }}
              />
              <button className="btn-primary" onClick={onGenerateToken} style={{ padding: '8px 18px' }}>Generate</button>
            </div>
          </>
        )}
      </div>


    </div>
  );
}
