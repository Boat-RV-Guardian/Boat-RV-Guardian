import { SignJWT, importPKCS8 } from 'jose';

export interface Env {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_CLIENT_EMAIL: string;
  FIREBASE_PRIVATE_KEY: string;
}

/**
 * Generates a Google OAuth2 Access Token using the Firebase Service Account Private Key.
 */
async function getFirebaseAccessToken(env: Env): Promise<string> {
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

const strField = (fields: any, key: string): string => fields?.[key]?.stringValue || '';
const arrField = (fields: any, key: string): string[] =>
  (fields?.[key]?.arrayValue?.values || []).map((v: any) => v.stringValue).filter(Boolean);

/** Overwrite a Firestore document's fields (REST PATCH, value-wrapped). */
async function setFirestoreDoc(env: Env, token: string, path: string, fields: Record<string, any>): Promise<void> {
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) console.warn(`Firestore write failed: ${res.status} ${await res.text()}`);
}

/** Send an FCM HTTP v1 push to a single registration token. */
async function sendFcmPush(env: Env, token: string, fcmToken: string, title: string, body: string): Promise<void> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { token: fcmToken, notification: { title, body } } }),
  });
  if (!res.ok) console.warn(`FCM send failed: ${res.status} ${await res.text()}`);
}

/** Events that should trigger an automatic water shutoff. */
const FLOOD_EVENT_RE = /flood|leak|alarm/i;

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
 * Shelly sensor webhook → push the alert to everyone who has access to the vehicle, and on a flood
 * event ALSO close the LinkTap valve (cloud fallback for when no local app is running to do it).
 * The device is provisioned to call /api/shelly?vid=<id>&event=<event>.
 */
async function handleShellyWebhook(env: Env, url: URL): Promise<Response> {
  const vid = url.searchParams.get('vid');
  const event = url.searchParams.get('event') || 'sensor alert';
  const device = (url.searchParams.get('device') || 'unknown').replace(/[\/#?]/g, '_');
  if (!vid) return new Response('Missing vid', { status: 400 });

  const token = await getFirebaseAccessToken(env);
  const vehicle = await getFirestoreDoc(env, token, `vehicles/${vid}`);
  if (!vehicle) return new Response('Vehicle not found', { status: 404 });

  const name = strField(vehicle, 'lt_vessel_name') || 'your vehicle';
  const uids = arrField(vehicle, 'allowedUsers');
  const isFlood = FLOOD_EVENT_RE.test(event);
  // Periodic telemetry (e.g. voltmeter.measurement every 60s) is cached for remote display but must
  // NOT generate a push — otherwise it'd notify every minute. Only real alerts push.
  const isTelemetry = /\.(measurement|change)$/i.test(event);
  const now = Date.now();

  // Cache last-known state so the app can show it without polling (also serves the offline-return
  // case). Beyond the event name we also persist any telemetry the device embedded in the webhook
  // URL (e.g. ?v=<calibrated volts>&vraw=<raw>&tC=<temp>) so the app can render live values remotely.
  const extra: Record<string, { stringValue: string }> = {};
  for (const [k, val] of url.searchParams) {
    if (k === 'vid' || k === 'event' || k === 'device') continue;
    if (val === '' || val === 'null') continue; // skip unset placeholders
    extra[k] = { stringValue: val };
  }
  await setFirestoreDoc(env, token, `vehicles/${vid}/sensorState/${device}`, {
    event: { stringValue: event },
    at: { integerValue: String(now) },
    ...extra,
  });

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

  let sent = 0;
  if (!isTelemetry) {
    for (const uid of uids) {
      const user = await getFirestoreDoc(env, token, `users/${uid}`);
      const fcmToken = strField(user, 'fcmToken');
      if (fcmToken) { await sendFcmPush(env, token, fcmToken, title, body); sent++; }
    }
  }
  return new Response(JSON.stringify({ status: 'ok', notified: sent, event, telemetry: isTelemetry, shutoff }), {
    headers: { 'Content-Type': 'application/json' }, status: 200,
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);

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
