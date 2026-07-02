// Client trigger for the server-authoritative Basic-trial grant (open-tasks Task 6). The real
// per-user / per-vehicle anti-abuse rule + the tier/trialEndsAt writes live in the worker
// (`POST /api/trial`, in the webhook worker — brvg-cloud-server); this just calls it with the ID
// token. We deliberately keep NO local tier state here — on a grant the worker writes the vehicle's
// cloud doc, and the existing onSnapshot → SyncModal stash reflects the new tier/expiry back into the
// app. So a failed/blocked call simply leaves the vehicle on its current tier; nothing to roll back.
//
// Dependencies (fetch, ID-token source, worker base URL) are injectable so the logic is unit-testable
// without Firebase or a network.

import { auth } from '../services/firebase';
import { DEFAULT_WORKER_URL } from './configSync';

export interface TrialResult {
  /** True only when the worker granted (and wrote) a Basic trial for the vehicle. */
  granted: boolean;
  tier?: string;
  /** Epoch ms the granted trial expires. */
  trialEndsAt?: number;
  /** Why a grant was declined (ineligible) — surfaced for logging, not an error. */
  reason?: string;
  /** Transport / auth / HTTP error — distinct from a clean "not eligible" decline. */
  error?: string;
}

export interface RequestTrialDeps {
  fetchFn?: typeof fetch;
  /** Returns the caller's Firebase ID token, or null if not signed in. */
  getIdToken?: () => Promise<string | null>;
  /** Worker base URL override — TEST-ONLY. Production always pins to DEFAULT_WORKER_URL (see below). */
  workerBase?: string;
}

/**
 * Resolve the worker base URL for the trial call.
 *
 * SECURITY: this request carries the user's Firebase ID token in an Authorization header, so it must
 * go ONLY to the trusted first-party worker. It deliberately does NOT read `sh_webhook_url` (the
 * per-vehicle "custom cloud server URL" any vehicle admin can set) — pointing it at an attacker's
 * server would leak members' ID tokens (full identity impersonation against Firestore/worker). Pinned
 * to DEFAULT_WORKER_URL; the `override` is honored only for unit tests.
 */
function resolveWorkerBase(override?: string): string {
  const base = override ?? DEFAULT_WORKER_URL;
  return base.replace(/\/+$/, '');
}

/**
 * Ask the worker to grant the one-month free Basic trial for `vid`. Requires a signed-in user (the
 * worker checks they own the vehicle). Returns `{granted:true,...}` only if the worker actually wrote
 * the trial; `{granted:false, reason}` when the anti-abuse rule declined; `{granted:false, error}` on
 * a transport/auth failure. Never throws.
 */
export async function requestTrial(vid: string, deps: RequestTrialDeps = {}): Promise<TrialResult> {
  if (!vid) return { granted: false, error: 'no vid' };

  const getIdToken = deps.getIdToken || (async () => {
    const u = auth.currentUser;
    return u ? await u.getIdToken() : null;
  });

  let token: string | null;
  try {
    token = await getIdToken();
  } catch (e: any) {
    return { granted: false, error: 'token error: ' + String(e?.message || e) };
  }
  if (!token) return { granted: false, error: 'not signed in' };

  const fetchFn = deps.fetchFn || fetch;
  const url = `${resolveWorkerBase(deps.workerBase)}/api/trial`;

  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ vid }),
    });
  } catch (e: any) {
    return { granted: false, error: String(e?.message || e) };
  }

  let data: any = {};
  try { data = await res.json(); } catch { /* tolerate an empty/non-JSON body */ }
  if (!res.ok) return { granted: false, error: data?.error || `HTTP ${res.status}` };

  if (data?.granted) {
    const trialEndsAt = Number(data.trialEndsAt);
    return {
      granted: true,
      tier: String(data.tier || 'basic'),
      trialEndsAt: Number.isFinite(trialEndsAt) ? trialEndsAt : undefined,
    };
  }
  return { granted: false, reason: data?.reason };
}
