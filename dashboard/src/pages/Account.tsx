import { useState } from 'react';
import { useEntitlements } from '../hooks/useEntitlements';
import { entitlementSummary, TIER_LABELS, TIER_PRICING } from '../utils/entitlements';
import { redeemCoupon, MOCK_COUPONS } from '../utils/billing';
import { trialStatus, usageRows, vehiclePlanRows } from '../utils/accountSummary';
import { usageHistoryToCsv, type DeviceUsage } from '../utils/historyCsv';
import {
  parseSmsPrefs, serializeSmsPrefs, normalizePhone, addPhone, removePhone, setEventEnabled,
  SMS_EVENT_CATALOG, type SmsPrefs,
} from '../utils/smsPrefs';
import {
  parseApiTokens, serializeApiTokens, addApiToken, revokeApiToken, randomToken, maskToken,
  type ApiToken,
} from '../utils/apiTokens';
import { requestTrial } from '../utils/trial';
import DeleteAccountButton from '../components/DeleteAccountButton';
import EditDisplayName from '../components/EditDisplayName';
import AccountActions from '../components/AccountActions';

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
export default function Account({ user }: { user?: { uid?: string; email?: string | null; displayName?: string | null } | null }) {
  const ent = useEntitlements();
  const price = TIER_PRICING[ent.tier];
  const rows = entitlementSummary(ent);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // SMS / voice alert channels (Premium, per-vehicle). Persisted to the synced `sh_sms_prefs` field;
  // dispatching settings_updated lets SyncModal push it to the cloud like any other config.
  const [smsPrefs, setSmsPrefs] = useState<SmsPrefs>(() => parseSmsPrefs(localStorage.getItem('sh_sms_prefs')));
  const [phoneInput, setPhoneInput] = useState('');
  const [phoneErr, setPhoneErr] = useState('');
  const persistSms = (next: SmsPrefs) => {
    setSmsPrefs(next);
    localStorage.setItem('sh_sms_prefs', serializeSmsPrefs(next));
    window.dispatchEvent(new Event('settings_updated'));
  };
  const onAddPhone = () => {
    if (!normalizePhone(phoneInput)) { setPhoneErr('Enter a valid phone (7–15 digits, optional +).'); return; }
    setPhoneErr('');
    persistSms(addPhone(smsPrefs, phoneInput));
    setPhoneInput('');
  };

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
  const usage = usageRows(ent, {
    vehicleCount: Object.keys(readLocalJson<Record<string, unknown>>('lt_vehicles', {})).length || 1,
    deviceCount: devices.length,
  });

  const apply = () => {
    const r = redeemCoupon(code);
    setMsg(r.ok ? { ok: true, text: `✓ Applied — this vehicle is now ${TIER_LABELS[r.tier!]}.` } : { ok: false, text: r.error || 'Failed' });
    if (r.ok) setCode('');
  };

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

  // Premium "data export": flatten each device's on-device usage history (lt_usage_history_<id>) to
  // a CSV and download it. The history key mirrors LinkTapWidget (`linktapDeviceId || id`).
  const exportCsv = () => {
    const data: DeviceUsage[] = devices.map((d) => {
      const key = d.linktapDeviceId || d.id;
      let usageMap: Record<string, number> = {};
      try { usageMap = JSON.parse(localStorage.getItem(`lt_usage_history_${key}`) || '{}'); } catch { /* skip */ }
      return { device: d.name || key, usage: usageMap };
    });
    const blob = new Blob([usageHistoryToCsv(data)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'brvg-usage-history.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding: '20px', maxWidth: '720px', margin: '0 auto', color: '#fff', paddingBottom: '100px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <h2 style={{ fontSize: '2rem', color: 'var(--accent-cyan)', margin: 0 }}>Account &amp; Plan</h2>

      {/* Account basics (Task 14) */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <h3 style={{ margin: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>Account</h3>
        {user ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Signed in as</span>
              <EditDisplayName uid={user.uid} displayName={user.displayName} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Email</span>
              <span>{user.email || '—'}</span>
            </div>
            {ent.canSmsAlert && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '5px 0' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Support</span>
                <span style={{ color: '#22c55e' }}>Priority support (Premium)</span>
              </div>
            )}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Sign in to manage your account details.</p>
        )}
        <AccountActions user={user} />
      </div>

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

      {/* Usage vs plan (Task 14) */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <h3 style={{ margin: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>Usage &amp; limits</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {usage.map((r) => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>{r.label}</span>
              <span style={{ color: r.on ? '#fff' : 'var(--text-secondary)' }}>{r.value}</span>
            </div>
          ))}
        </div>
      </div>

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

      {/* Data & privacy (Task 14) — CSV export is a Premium feature (canExport) */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <h3 style={{ margin: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>Data &amp; privacy</h3>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            Export this device's water-usage history as CSV.{!ent.canExport && ' (Premium)'}
          </span>
          <button className="btn-primary" onClick={exportCsv} disabled={!ent.canExport} style={{ padding: '8px 18px', opacity: ent.canExport ? 1 : 0.5 }} title={ent.canExport ? 'Download CSV' : 'Upgrade to Premium to export'}>
            Export CSV
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

      {/* Alert channels — SMS/voice escalation (Task 6/14). Premium-gated (canSmsAlert). No live
          provider yet: prefs are stored + synced; the worker send path (worker/src/sms.ts) is a stub. */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <h3 style={{ margin: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>
          SMS &amp; voice alerts{!ent.canSmsAlert && ' (Premium)'}
        </h3>
        {!ent.canSmsAlert ? (
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
            Escalate critical alerts (flood, low battery, shore power, offline) to a text message.
            Upgrade to Premium to add phone numbers and choose which alerts text you.
          </p>
        ) : (
          <>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
              Add the numbers that should receive a text for the alerts you pick below. (Delivery goes
              live once an SMS provider is connected.)
            </p>
            {/* Phone numbers */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {smsPrefs.phones.map((p) => (
                <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '14px', padding: '4px 10px', fontSize: '0.82rem' }}>
                  {p}
                  <button onClick={() => persistSms(removePhone(smsPrefs, p))} aria-label={`Remove ${p}`} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: 0 }}>×</button>
                </span>
              ))}
              {smsPrefs.phones.length === 0 && (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>No numbers yet.</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="tel"
                value={phoneInput}
                onChange={(e) => { setPhoneInput(e.target.value); setPhoneErr(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') onAddPhone(); }}
                placeholder="+1 555 123 4567"
                style={{ flex: '1 1 180px', padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: '#fff' }}
              />
              <button className="btn-primary" onClick={onAddPhone} style={{ padding: '8px 18px' }}>Add</button>
            </div>
            {phoneErr && <span style={{ fontSize: '0.78rem', color: 'var(--accent-red, #ff6b6b)' }}>{phoneErr}</span>}
            {/* Per-event opt-in */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
              {SMS_EVENT_CATALOG.map((ev) => (
                <label key={ev.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  <input
                    type="checkbox"
                    checked={smsPrefs.events.includes(ev.key)}
                    onChange={(e) => persistSms(setEventEnabled(smsPrefs, ev.key, e.target.checked))}
                  />
                  {ev.label}
                </label>
              ))}
            </div>
          </>
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
