import { SignJWT, importPKCS8, jwtVerify, importX509, decodeProtectedHeader } from 'jose';
import {
  isFloodShutoff, isTelemetry, extractSensorStateExtras, sanitizeDevice,
  telemetryResolutionSecForTier, shouldPersistTelemetry, TELEMETRY_RESOLUTION_SEC,
  healthBody,
} from './events';
import { Cached, isCacheFresh, tokenValid, tokenExpiryMs } from './cache';
import {
  isTrialExpired, historyRetentionDaysForTier, historyDocsToPrune,
  isTrialEligible, trialEndsAtFrom,
} from './retention';
import { resolveRole, canControl, validateControlCommand, ControlAction } from './authz';

export interface Env {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_CLIENT_EMAIL: string;
  FIREBASE_PRIVATE_KEY: string;
}

// — In-isolate caches (open-tasks Task 8 cost levers) —
// Cloudflare reuses a Worker isolate across many requests, so module-scope state survives between
// webhooks. Caching the OAuth token (valid ~1h) and the vehicle doc collapses the redundant per-
// telemetry OAuth round-trip + Firestore read. Both fail safe (a miss just re-fetches); the flood
// path bypasses the vehicle cache for fresh credentials. Expiry math lives in ./cache (unit-tested).
let cachedToken: { token: string; expiresAtMs: number } | null = null;
/** TTL for a cached vehicle doc — short, since config changes should propagate within ~a minute. */
const VEHICLE_CACHE_TTL_MS = 60_000;
const vehicleDocCache = new Map<string, Cached<any>>();

/** Google's public x509 certs for verifying Firebase ID-token signatures. */
const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

/**
 * Verify a Firebase ID token (signature against Google's public certs + issuer/audience/expiry) and
 * return its claims. Throws on any failure. Same approach as the admin site's operators function — a
 * caller can't forge a token, so the `uid` in the returned claims is trustworthy for the role check.
 */
async function verifyFirebaseIdToken(idToken: string, projectId: string): Promise<any> {
  const { kid } = decodeProtectedHeader(idToken);
  if (!kid) throw new Error('no kid');
  const certs: Record<string, string> = await fetch(FIREBASE_CERTS_URL).then((r) => r.json());
  const pem = certs[kid];
  if (!pem) throw new Error('unknown signing key');
  const key = await importX509(pem, 'RS256');
  const { payload } = await jwtVerify(idToken, key, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });
  return payload;
}

/**
 * Generates (and caches) a Google OAuth2 Access Token using the Firebase Service Account Private Key.
 * The token endpoint returns the token's lifetime (`expires_in`, ~3600s); we reuse the token across
 * requests until it nears expiry (60s skew) instead of minting a fresh JWT every webhook.
 */
async function getFirebaseAccessToken(env: Env): Promise<string> {
  const now = Date.now();
  if (cachedToken && tokenValid(cachedToken.expiresAtMs, now)) return cachedToken.token;

  const privateKeyStr = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const privateKey = await importPKCS8(privateKeyStr, 'RS256');

  const jwt = await new SignJWT({
    iss: env.FIREBASE_CLIENT_EMAIL,
    sub: env.FIREBASE_CLIENT_EMAIL,
    aud: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging'
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  if (!res.ok) {
    throw new Error(`Failed to get OAuth token: ${await res.text()}`);
  }

  const data: any = await res.json();
  cachedToken = { token: data.access_token, expiresAtMs: tokenExpiryMs(Date.now(), data.expires_in) };
  return data.access_token;
}

/**
 * Retrieves the user's LinkTap API config from Firestore.
 */
async function getLinkTapConfigFromFirestore(env: Env, token: string, vid: string): Promise<any> {
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/vehicles/${vid}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Firestore doc: ${await res.text()}`);
  }

  const data: any = await res.json();
  
  if (!data.fields) {
    throw new Error('Vehicle configuration not found in Firestore.');
  }

  return {
    username: data.fields.lt_cloud_user?.stringValue || '',
    apiKey: data.fields.lt_cloud_key?.stringValue || '',
    gatewayId: data.fields.lt_gateway_id?.stringValue || '',
    taplinkerId: data.fields.lt_device_id?.stringValue || ''
  };
}

/**
 * Triggers the LinkTap Cloud API to instantly shut off the water.
 *
 * Uses activateInstantMode with action:false (duration 0) — the same call the dashboard app uses
 * to stop the valve. The previous endpoint, /api/turnOffV2, no longer exists (LinkTap returns an
 * HTML "not a valid path" 404), which silently broke every cloud-side flood shutoff (confirmed on
 * hardware: the worker's shutoff result was `LinkTap API failure: <!DOCTYPE html>... turnOffV2 is
 * not a valid path`).
 */
async function triggerLinkTapShutoff(config: any): Promise<void> {
  const payload = {
    username: config.username,
    apiKey: config.apiKey,
    gatewayId: config.gatewayId,
    taplinkerId: config.taplinkerId,
    action: false,
    duration: 0,
    autoBack: true
  };

  const res = await fetch('https://www.link-tap.com/api/activateInstantMode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error(`LinkTap API failure: ${await res.text()}`);
  }

  const data: any = await res.json();
  if (data.result === 'error') {
    throw new Error(`LinkTap API error: ${data.message}`);
  }
}

/**
 * Reads a Firestore document and returns its raw `fields` object (REST value-wrapped).
 */
async function getFirestoreDoc(env: Env, token: string, path: string): Promise<any | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const data: any = await res.json();
  return data.fields || null;
}

/**
 * Vehicle doc read with a short in-isolate cache (Task 8). Pass `bypassCache` on the safety path so a
 * flood always acts on fresh LinkTap credentials. A successful fresh read refreshes the cache for the
 * common telemetry path; a null (not-found / error) is NOT cached so a transient miss can't stick.
 */
async function getVehicleDocCached(env: Env, token: string, vid: string, bypassCache = false): Promise<any | null> {
  const now = Date.now();
  if (!bypassCache) {
    const hit = vehicleDocCache.get(vid);
    if (hit && isCacheFresh(hit.at, now, VEHICLE_CACHE_TTL_MS)) return hit.value;
  }
  const fresh = await getFirestoreDoc(env, token, `vehicles/${vid}`);
  if (fresh) vehicleDocCache.set(vid, { value: fresh, at: now });
  return fresh;
}

const strField = (fields: any, key: string): string => fields?.[key]?.stringValue || '';
const arrField = (fields: any, key: string): string[] =>
  (fields?.[key]?.arrayValue?.values || []).map((v: any) => v.stringValue).filter(Boolean);
/** Read a numeric Firestore field (REST wraps numbers as integerValue/doubleValue strings). */
const numField = (fields: any, key: string): number | null => {
  const raw = fields?.[key]?.integerValue ?? fields?.[key]?.doubleValue;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};
/**
 * Unwrap the REST-encoded `members` map ({ <uid>: { role, email } }) into a plain
 * { uid: { role } } for resolveRole. Firestore nests it as mapValue.fields[uid].mapValue.fields.role.
 */
const membersField = (fields: any): Record<string, { role?: string }> => {
  const map = fields?.members?.mapValue?.fields || {};
  const out: Record<string, { role?: string }> = {};
  for (const [uid, v] of Object.entries<any>(map)) {
    out[uid] = { role: v?.mapValue?.fields?.role?.stringValue };
  }
  return out;
};

const docsBase = (env: Env) =>
  `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

/** Overwrite a Firestore document's fields (REST PATCH, value-wrapped). */
async function setFirestoreDoc(env: Env, token: string, path: string, fields: Record<string, any>): Promise<void> {
  const res = await fetch(`${docsBase(env)}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) console.warn(`Firestore write failed: ${res.status} ${await res.text()}`);
}

/**
 * Precise field-level PATCH using an updateMask: ONLY the masked paths are touched, and a masked path
 * absent from `fields` is DELETED. Used by the maintenance cron to flip `tier`→free and remove
 * `trialEndsAt` on a lapsed trial WITHOUT clobbering the rest of the (large) vehicle doc.
 */
async function patchFirestoreFields(
  env: Env, token: string, path: string, fields: Record<string, any>, maskPaths: string[],
): Promise<boolean> {
  const mask = maskPaths.map((p) => `updateMask.fieldPaths=${encodeURIComponent(p)}`).join('&');
  const res = await fetch(`${docsBase(env)}/${path}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) { console.warn(`Firestore patch failed (${path}): ${res.status} ${await res.text()}`); return false; }
  return true;
}

/** Delete a Firestore document. Returns whether it succeeded. */
async function deleteFirestoreDoc(env: Env, token: string, path: string): Promise<boolean> {
  const res = await fetch(`${docsBase(env)}/${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) { console.warn(`Firestore delete failed (${path}): ${res.status} ${await res.text()}`); return false; }
  return true;
}

/**
 * List a Firestore collection, returning each doc's id + fields. Paginates to completion (capped) and
 * supports a field `mask` so we only pull the fields we need (e.g. just `month` when scanning history
 * — avoids dragging back large usage/event maps). `pageCap` bounds a runaway loop.
 */
async function listFirestoreCollection(
  env: Env, token: string, collectionPath: string, maskFields?: string[], pageCap = 50,
): Promise<Array<{ id: string; fields: any }>> {
  const out: Array<{ id: string; fields: any }> = [];
  let pageToken: string | undefined;
  for (let page = 0; page < pageCap; page++) {
    const params = new URLSearchParams({ pageSize: '300' });
    if (pageToken) params.set('pageToken', pageToken);
    for (const f of maskFields || []) params.append('mask.fieldPaths', f);
    const res = await fetch(`${docsBase(env)}/${collectionPath}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { console.warn(`Firestore list failed (${collectionPath}): ${res.status}`); break; }
    const data: any = await res.json();
    for (const d of data.documents || []) {
      out.push({ id: String(d.name).split('/').pop() || '', fields: d.fields || {} });
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out;
}

/**
 * Send an FCM HTTP v1 push to a single registration token. Returns whether FCM accepted it (200), so
 * the caller can report REAL delivery counts — a 403 (missing IAM role) or invalid token no longer
 * looks like a success.
 */
async function sendFcmPush(env: Env, token: string, fcmToken: string, title: string, body: string): Promise<boolean> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { token: fcmToken, notification: { title, body } } }),
  });
  if (!res.ok) { console.warn(`FCM send failed: ${res.status} ${await res.text()}`); return false; }
  return true;
}

/**
 * Close the valve via the LinkTap cloud API with retries. The LinkTap cloud API is rate-limited
 * (~1 call / 30s), so a recent client poll can briefly block this safety command — we retry with a
 * short backoff so the OFF wins. Closing is idempotent, so a redundant close (a local app also
 * closed it) is harmless. Local-gateway closes by the app aren't rate-limited and are preferred;
 * this worker path is the no-local-app fallback.
 */
async function triggerLinkTapShutoffWithRetry(config: any, attempts = 3): Promise<{ ok: boolean; error?: string }> {
  for (let i = 0; i < attempts; i++) {
    try {
      await triggerLinkTapShutoff(config);
      return { ok: true };
    } catch (e: any) {
      if (i === attempts - 1) return { ok: false, error: String(e?.message || e) };
      await new Promise((r) => setTimeout(r, 3000)); // wait out transient rate-limit/contention
    }
  }
  return { ok: false, error: 'exhausted' };
}

/**
 * Issue a LinkTap instant-mode command for the role-enforced control endpoint (Task 4). Mirrors the
 * dashboard's own cloud call: open = action:true with a bounded `duration` (minutes, ≤1439) and an
 * optional `vol` (liters) limit; close = action:false, duration:0. `autoBack:true` returns the valve
 * to its schedule afterward. NOTE: this is a SEPARATE function from the flood-shutoff path on purpose
 * — the safety close (triggerLinkTapShutoff) stays untouched.
 */
async function triggerLinkTapInstant(
  config: any, action: ControlAction, durationMins: number, vol?: number,
): Promise<void> {
  const payload: any = {
    username: config.username,
    apiKey: config.apiKey,
    gatewayId: config.gatewayId,
    taplinkerId: config.taplinkerId,
    action: action === 'open',
    duration: action === 'open' ? durationMins : 0,
    autoBack: true,
  };
  if (action === 'open' && typeof vol === 'number' && vol > 0) payload.vol = vol;

  const res = await fetch('https://www.link-tap.com/api/activateInstantMode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`LinkTap API failure: ${await res.text()}`);
  const data: any = await res.json();
  if (data.result === 'error') throw new Error(`LinkTap API error: ${data.message}`);
}

/**
 * POST /api/control — role-enforced valve control (open-tasks Task 4). The server, not just the
 * client, now enforces who may act on the valve:
 *   1. Require + VERIFY the caller's Firebase ID token (signature/iss/aud/exp) → trustworthy uid.
 *   2. Resolve that uid's role from the vehicle's members map; only admin/control may proceed (a
 *      monitor — even one holding the cloud credentials — gets 403 here, which they could bypass by
 *      calling LinkTap directly today).
 *   3. Validate the command, enforcing the safety self-limit (an OPEN must carry a bounded duration).
 *   4. Relay to LinkTap using the vehicle's stored credentials (never exposed to the client).
 * Body: { vid, action: 'open'|'close', durationSec?, volumeLimitLiters? }.
 */
async function handleControl(env: Env, request: Request): Promise<Response> {
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  const m = /^Bearer (.+)$/.exec(request.headers.get('Authorization') || '');
  if (!m) return reply({ error: 'missing token' }, 401);

  let uid = '';
  try {
    const claims = await verifyFirebaseIdToken(m[1], env.FIREBASE_PROJECT_ID);
    uid = String(claims.user_id || claims.sub || '');
  } catch (e: any) {
    return reply({ error: 'invalid token: ' + (e?.message || e) }, 401);
  }
  if (!uid) return reply({ error: 'token has no uid' }, 401);

  let body: any;
  try { body = await request.json(); } catch { return reply({ error: 'invalid JSON body' }, 400); }
  const vid = String(body?.vid || '');
  const action = body?.action as ControlAction;
  if (!vid) return reply({ error: 'missing vid' }, 400);

  const token = await getFirebaseAccessToken(env);
  const vehicle = await getFirestoreDoc(env, token, `vehicles/${vid}`);
  if (!vehicle) return reply({ error: 'vehicle not found' }, 404);

  // AUTHORIZE — server-side role check (the whole point of this endpoint).
  const role = resolveRole(membersField(vehicle), arrField(vehicle, 'allowedUsers'), uid);
  if (!canControl(role)) return reply({ error: 'forbidden: role cannot control', role }, 403);

  // VALIDATE — enforce the open-requires-limit safety invariant server-side too.
  const v = validateControlCommand({ action, durationSec: body?.durationSec, volumeLimitLiters: body?.volumeLimitLiters });
  if (!v.ok) return reply({ error: v.error }, 400);

  const username = strField(vehicle, 'lt_cloud_user');
  const apiKey = strField(vehicle, 'lt_cloud_key');
  const gatewayId = strField(vehicle, 'lt_gateway_id');
  const taplinkers = [strField(vehicle, 'lt_device_id'), strField(vehicle, 'lt_device_id_2')].filter(Boolean);
  if (!username || !apiKey || !gatewayId || !taplinkers.length) {
    return reply({ error: 'no LinkTap config' }, 400);
  }

  let ok = 0; let lastErr = '';
  for (const tap of taplinkers) {
    try {
      await triggerLinkTapInstant({ username, apiKey, gatewayId, taplinkerId: tap }, action, v.durationMins || 0, v.vol);
      ok++;
    } catch (e: any) { lastErr = String(e?.message || e); }
  }
  return reply(
    ok === taplinkers.length
      ? { status: 'ok', action, valves: ok }
      : { status: 'partial', action, valves: ok, error: lastErr },
    ok > 0 ? 200 : 502,
  );
}

/**
 * Server-authoritative one-month free Basic trial grant (open-tasks Task 6). The client cannot be
 * trusted to enforce the per-user / per-vehicle anti-abuse rule (it could just skip writing
 * `trialsUsed`), so the grant runs here: verify the caller's ID token, confirm they own the vehicle
 * (admin role), then apply the decided `isTrialEligible` rule against authoritative Firestore state
 * and, only if eligible, write `tier='basic'` + `trialEndsAt` to the vehicle AND append the vid to
 * the user's `users/{uid}.trialsUsed`. Idempotent for an ineligible caller (returns granted:false).
 * The daily maintenance cron later lapses the trial back to `free` when `trialEndsAt` passes.
 */
async function handleTrial(env: Env, request: Request, now = Date.now()): Promise<Response> {
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  const m = /^Bearer (.+)$/.exec(request.headers.get('Authorization') || '');
  if (!m) return reply({ error: 'missing token' }, 401);

  let uid = '';
  try {
    const claims = await verifyFirebaseIdToken(m[1], env.FIREBASE_PROJECT_ID);
    uid = String(claims.user_id || claims.sub || '');
  } catch (e: any) {
    return reply({ error: 'invalid token: ' + (e?.message || e) }, 401);
  }
  if (!uid) return reply({ error: 'token has no uid' }, 401);

  let body: any;
  try { body = await request.json(); } catch { return reply({ error: 'invalid JSON body' }, 400); }
  const vid = String(body?.vid || '');
  if (!vid) return reply({ error: 'missing vid' }, 400);

  const token = await getFirebaseAccessToken(env);
  const vehicle = await getFirestoreDoc(env, token, `vehicles/${vid}`);
  if (!vehicle) return reply({ error: 'vehicle not found' }, 404);

  // AUTHORIZE — only the vehicle owner (admin) may claim its trial; the tier is billed per-vehicle.
  const role = resolveRole(membersField(vehicle), arrField(vehicle, 'allowedUsers'), uid);
  if (role !== 'admin') return reply({ error: 'forbidden: only the vehicle owner can start a trial', role }, 403);

  // ELIGIBILITY — authoritative anti-abuse check against Firestore (NOT the client's claim).
  const userDoc = await getFirestoreDoc(env, token, `users/${uid}`);
  const trialsUsed = arrField(userDoc, 'trialsUsed');
  const vehicleTrialEndsAt = numField(vehicle, 'trialEndsAt');
  if (!isTrialEligible(vid, trialsUsed, vehicleTrialEndsAt)) {
    return reply({ granted: false, reason: 'not eligible (already trialed this vehicle, or it has trialed before)' });
  }

  // GRANT — vehicle gets tier=basic + a 30-day expiry; the user records the vid so it can't re-trial.
  const trialEndsAt = trialEndsAtFrom(now);
  const vehicleOk = await patchFirestoreFields(
    env, token, `vehicles/${vid}`,
    { tier: { stringValue: 'basic' }, trialEndsAt: { integerValue: String(trialEndsAt) } },
    ['tier', 'trialEndsAt'],
  );
  if (!vehicleOk) return reply({ error: 'failed to write vehicle trial' }, 502);

  const nextTrialsUsed = [...trialsUsed, vid];
  await patchFirestoreFields(
    env, token, `users/${uid}`,
    { trialsUsed: { arrayValue: { values: nextTrialsUsed.map((v) => ({ stringValue: v })) } } },
    ['trialsUsed'],
  );

  return reply({ granted: true, tier: 'basic', trialEndsAt });
}

/**
 * Shelly sensor webhook → push the alert to everyone who has access to the vehicle, and on a flood
 * event ALSO close the LinkTap valve (cloud fallback for when no local app is running to do it).
 * The device is provisioned to call /api/shelly?vid=<id>&event=<event>.
 * (Event classification + param extraction live in ./events for reuse + unit testing.)
 */
async function handleShellyWebhook(env: Env, url: URL): Promise<Response> {
  const vid = url.searchParams.get('vid');
  const event = url.searchParams.get('event') || 'sensor alert';
  const device = sanitizeDevice(url.searchParams.get('device'));
  if (!vid) return new Response('Missing vid', { status: 400 });

  // A flood SHUTOFF fires only on a real flood/leak alarm — never on the "cleared" (*.alarm_off)
  // variant (which also matches the flood family) and never on periodic telemetry. See ./events.
  // Decided up front (from the event alone) so the vehicle read can bypass the cache on the safety path.
  const isFlood = isFloodShutoff(event);

  const token = await getFirebaseAccessToken(env);
  const vehicle = await getVehicleDocCached(env, token, vid, isFlood);
  if (!vehicle) return new Response('Vehicle not found', { status: 404 });

  const name = strField(vehicle, 'lt_vessel_name') || 'your vehicle';
  const uids = arrField(vehicle, 'allowedUsers');
  // Periodic telemetry (e.g. voltmeter.measurement every 60s) is cached for remote display but must
  // NOT generate a push — otherwise it'd notify every minute. Only real alerts push.
  const telemetry = isTelemetry(event);
  const now = Date.now();

  // Cache last-known state so the app can show it without polling (also serves the offline-return
  // case). Beyond the event name we also persist any telemetry the device embedded in the webhook
  // URL (e.g. ?v=<calibrated volts>&vraw=<raw>&tC=<temp>) so the app can render live values remotely.
  const extra: Record<string, { stringValue: string }> = {};
  for (const [k, val] of Object.entries(extractSensorStateExtras(url.searchParams))) {
    extra[k] = { stringValue: val };
  }

  // Tier-aware telemetry throttle (cost lever + per-tier remote-view freshness, COST_ANALYSIS §5):
  // for periodic telemetry, persist the cached state only every `telemetryResolutionSec`. NON-telemetry
  // events (incl. every flood/alarm) ALWAYS persist — the safety path is never throttled. Premium /
  // legacy vehicles use the 60s cadence, so for them we skip the extra read and behave as before.
  let persisted = true;
  const resolutionSec = telemetryResolutionSecForTier(strField(vehicle, 'tier'));
  if (telemetry && resolutionSec > TELEMETRY_RESOLUTION_SEC.premium) {
    const prev = await getFirestoreDoc(env, token, `vehicles/${vid}/sensorState/${device}`);
    const lastAt = Number(prev?.at?.integerValue ?? prev?.at?.doubleValue);
    persisted = shouldPersistTelemetry(now, Number.isFinite(lastAt) ? lastAt : null, resolutionSec);
  }
  if (persisted) {
    await setFirestoreDoc(env, token, `vehicles/${vid}/sensorState/${device}`, {
      event: { stringValue: event },
      at: { integerValue: String(now) },
      ...extra,
    });
  }

  // SAFETY: on a flood/leak event, close every configured LinkTap valve via the cloud API. The app
  // (if open) also closes locally — redundant closes are harmless, and this guarantees shutoff when
  // no app is running. Reuses the already-fetched vehicle doc (no extra Firestore read).
  let shutoff: { ok: boolean; error?: string; valves?: number } | null = null;
  if (isFlood) {
    const username = strField(vehicle, 'lt_cloud_user');
    const apiKey = strField(vehicle, 'lt_cloud_key');
    const gatewayId = strField(vehicle, 'lt_gateway_id');
    const taplinkers = [strField(vehicle, 'lt_device_id'), strField(vehicle, 'lt_device_id_2')].filter(Boolean);
    if (username && apiKey && gatewayId && taplinkers.length) {
      let okCount = 0; let lastErr = '';
      for (const tap of taplinkers) {
        const r = await triggerLinkTapShutoffWithRetry({ username, apiKey, gatewayId, taplinkerId: tap });
        if (r.ok) okCount++; else lastErr = r.error || 'failed';
      }
      shutoff = okCount === taplinkers.length
        ? { ok: okCount > 0, valves: okCount }
        : { ok: okCount > 0, valves: okCount, error: lastErr };
    } else {
      shutoff = { ok: false, error: 'no LinkTap config' };
    }
  }

  const title = `🚨 ${name}`;
  const body = isFlood
    ? (shutoff?.ok ? `Flood detected — valve closed automatically.` : `Flood detected: ${event}`)
    : `Sensor alert: ${event}`;

  // `notified` counts only pushes FCM actually ACCEPTED (200); `pushFailed` counts users who had a
  // token but whose send failed (e.g. 403 missing IAM role, stale token) — so the webhook response
  // is a real verification signal, not just "a token existed".
  let sent = 0; let pushFailed = 0;
  if (!telemetry) {
    for (const uid of uids) {
      const user = await getFirestoreDoc(env, token, `users/${uid}`);
      const fcmToken = strField(user, 'fcmToken');
      if (fcmToken) { (await sendFcmPush(env, token, fcmToken, title, body)) ? sent++ : pushFailed++; }
    }
  }
  return new Response(JSON.stringify({ status: 'ok', notified: sent, pushFailed, event, telemetry, persisted, shutoff }), {
    headers: { 'Content-Type': 'application/json' }, status: 200,
  });
}

/**
 * Daily tier-maintenance sweep (open-tasks Task 6 server-side enforcement). Runs from the cron
 * trigger in wrangler.toml. Two passes over every vehicle:
 *   1. TRIAL EXPIRY — a vehicle carrying a lapsed `trialEndsAt` is flipped `tier`→`free` and the
 *      marker removed (precise field PATCH; the rest of the doc is untouched). The client reads
 *      `tier`, so no app change is needed.
 *   2. HISTORY RETENTION — hosted monthly history rollups older than the vehicle's (post-expiry) tier
 *      window are deleted. Legacy/unset tiers grandfather to premium (~3y) so existing data is NOT
 *      touched until a real tier is assigned. A per-run delete cap guards against a runaway.
 *
 * Selection logic is pure + unit-tested in ./retention; this only does the Firestore I/O. The live
 * webhook path is NOT touched by this routine.
 */
async function runDailyMaintenance(env: Env, now = Date.now(), deleteCap = 2000): Promise<void> {
  const token = await getFirebaseAccessToken(env);
  const vehicles = await listFirestoreCollection(env, token, 'vehicles', ['tier', 'trialEndsAt']);

  let trialsExpired = 0;
  let pruned = 0;
  let capped = false;

  for (const v of vehicles) {
    let tier = strField(v.fields, 'tier');

    // Pass 1 — lapse an expired Basic trial back to free.
    if (isTrialExpired(numField(v.fields, 'trialEndsAt'), now)) {
      const ok = await patchFirestoreFields(
        env, token, `vehicles/${v.id}`, { tier: { stringValue: 'free' } }, ['tier', 'trialEndsAt'],
      );
      if (ok) { tier = 'free'; trialsExpired++; }
    }

    // Pass 2 — prune hosted history beyond this vehicle's (now-current) tier window.
    if (capped) continue;
    const retentionDays = historyRetentionDaysForTier(tier);
    const hist = await listFirestoreCollection(env, token, `vehicles/${v.id}/history`, ['month']);
    const toDelete = historyDocsToPrune(hist.map((h) => h.id), retentionDays, now);
    for (const id of toDelete) {
      if (pruned >= deleteCap) { capped = true; break; }
      if (await deleteFirestoreDoc(env, token, `vehicles/${v.id}/history/${id}`)) pruned++;
    }
  }

  console.log(
    `maintenance: ${vehicles.length} vehicles, ${trialsExpired} trials expired, ${pruned} history docs pruned` +
    (capped ? ` (HIT delete cap ${deleteCap})` : ''),
  );
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Run to completion in the background; failures are logged, never thrown (a cron error would just
    // retry and can't affect the live webhook path).
    ctx.waitUntil(runDailyMaintenance(env).catch((e) => console.error('maintenance failed:', e)));
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);

      // Public liveness ping (open-tasks Task 12). First thing checked, no secrets/Firestore touched,
      // CORS-open so the admin console can reach it cross-origin. Cannot interfere with any other path.
      if (url.pathname === '/api/health' || url.pathname === '/healthz') {
        return new Response(JSON.stringify(healthBody(Date.now())), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
          },
        });
      }

      // Role-enforced valve control (open-tasks Task 4). CORS-open (auth is the verified ID token,
      // not the origin) so the web app build can call it; answer the preflight first.
      if (url.pathname === '/api/control') {
        if (request.method === 'OPTIONS') {
          return new Response(null, {
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            },
          });
        }
        if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
        return await handleControl(env, request);
      }

      // Server-authoritative Basic-trial grant (open-tasks Task 6). Same CORS/auth shape as
      // /api/control (verified ID token, not origin) so the web + native builds can call it.
      if (url.pathname === '/api/trial') {
        if (request.method === 'OPTIONS') {
          return new Response(null, {
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            },
          });
        }
        if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
        return await handleTrial(env, request);
      }

      // Shelly sensor alerts → push notifications + flood valve shutoff.
      // IMPORTANT: Shelly devices fire their outbound webhooks as GET requests, so this path must
      // be handled BEFORE any method check — a blanket POST-only guard here silently 405'd every
      // real flood alarm, disabling the entire auto-shutoff safety chain (confirmed on hardware).
      if (url.pathname === '/api/shelly') {
        return await handleShellyWebhook(env, url);
      }

      // Default (legacy) LinkTap auto-shutoff webhook is POST-only.
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }

      const vid = url.searchParams.get('vid');
      if (!vid) {
        return new Response('Missing vid parameter', { status: 400 });
      }

      console.log(`Processing webhook for vid: ${vid}`);

      // 1. Get Google OAuth Access Token
      const accessToken = await getFirebaseAccessToken(env);

      // 2. Fetch LinkTap Config from Firestore
      const linktapConfig = await getLinkTapConfigFromFirestore(env, accessToken, vid);

      if (!linktapConfig.username || !linktapConfig.apiKey || !linktapConfig.gatewayId || !linktapConfig.taplinkerId) {
        return new Response('Incomplete LinkTap config in Firestore', { status: 400 });
      }

      // 3. Trigger Water Shutoff via LinkTap
      await triggerLinkTapShutoff(linktapConfig);

      console.log(`Successfully triggered water shutoff for vid: ${vid}`);

      return new Response(JSON.stringify({ status: 'success', action: 'linktap_shutoff' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      });

    } catch (e: any) {
      console.error('Webhook error:', e);
      return new Response(`Bad Request: ${e.message}`, { status: 400 });
    }
  },
};
