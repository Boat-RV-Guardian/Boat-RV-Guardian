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
 */
async function triggerLinkTapShutoff(config: any): Promise<void> {
  const payload = {
    username: config.username,
    apiKey: config.apiKey,
    gatewayId: config.gatewayId,
    taplinkerId: config.taplinkerId,
    action: false,
    autoBack: true
  };

  const res = await fetch('https://www.link-tap.com/api/turnOffV2', {
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

/**
 * Shelly sensor webhook → push the alert to everyone who has access to the vehicle.
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
  const title = `🚨 ${name}`;
  const body = `Sensor alert: ${event}`;
  const now = Date.now();

  // Cache last-known state so the app can show it without polling (also serves the offline-return case).
  await setFirestoreDoc(env, token, `vehicles/${vid}/sensorState/${device}`, {
    event: { stringValue: event },
    at: { integerValue: String(now) },
  });

  let sent = 0;
  for (const uid of uids) {
    const user = await getFirestoreDoc(env, token, `users/${uid}`);
    const fcmToken = strField(user, 'fcmToken');
    if (fcmToken) { await sendFcmPush(env, token, fcmToken, title, body); sent++; }
  }
  return new Response(JSON.stringify({ status: 'ok', notified: sent, event }), {
    headers: { 'Content-Type': 'application/json' }, status: 200,
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    try {
      const url = new URL(request.url);

      // Shelly sensor alerts → push notifications to the vehicle's members.
      if (url.pathname === '/api/shelly') {
        return await handleShellyWebhook(env, url);
      }

      // Default (legacy) path: LinkTap auto-shutoff webhook.
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
