# Worker cutover runbook (Task 7)

Retire the old standalone worker and make **brvg-cloud-server**'s Cloudflare Worker adapter the live
`api.boatrvguardian.com` webhook worker. Owner-run — it touches the production flood-shutoff path.

## Background

- The old `worker/` directory was removed from this repo; the deployed `boat-rv-guardian-webhooks`
  worker keeps running on Cloudflare but its source is gone from git.
- The replacement is **brvg-cloud-server**'s worker adapter (`src/worker.ts`). It uses `FirestoreStorage`,
  so it reads/writes the **same Firestore** the app already syncs to — no data migration, no D1 needed.
  It has: FCM push, LinkTap cloud shutoff, SMS/WhatsApp/Telegram, `/api/control` (role-checked),
  `/api/trial`, daily retention cron, per-tier device limits, and per-vehicle webhook auth (SEC-4).

## Prerequisites (verify before deploying)

- brvg-cloud-server `main` is green (`tsc` + tests + `wrangler deploy --dry-run`).
- Firestore vehicle docs carry the fields the worker reads: `lt_cloud_*` (LinkTap), `allowedUsers`,
  `tier`, `sh_webhook_secret` (SEC-4), `sh_sms_prefs` / `sh_whatsapp_prefs` / `sh_telegram_prefs`.
  `FirestoreStorage.vehicleFromFields` maps all of these.
- The app emits `&k=<secret>` on Shelly provisioning and syncs `sh_webhook_secret` (shipped).

## Step 1 — deploy the new worker to a TEST URL (no traffic yet)

From `brvg-cloud-server/`:

```bash
# Secrets (required): the Firebase service account used for Firestore + FCM.
npx wrangler secret put FIREBASE_PROJECT_ID
npx wrangler secret put FIREBASE_CLIENT_EMAIL
npx wrangler secret put FIREBASE_PRIVATE_KEY   # exact key incl. BEGIN/END lines
# Optional messaging providers (omit a channel to leave it as a no-op):
npx wrangler secret put TWILIO_ACCOUNT_SID; npx wrangler secret put TWILIO_AUTH_TOKEN; npx wrangler secret put TWILIO_FROM
npx wrangler secret put WHATSAPP_PHONE_ID;   npx wrangler secret put WHATSAPP_TOKEN
npx wrangler secret put TELEGRAM_BOT_TOKEN
# LinkTap webhook gate (required before registering setWebHookUrl — pick a long random string):
npx wrangler secret put LINKTAP_WEBHOOK_SECRET

npx wrangler deploy            # deploys as `brvg-cloud-worker` on *.workers.dev (NOT the live domain yet)
```

## Step 2 — smoke-test the test URL (`https://brvg-cloud-worker.<acct>.workers.dev`)

- `GET /api/health` → `{ ok: true }`.
- `GET /api/shelly?vid=<real vid>&event=voltmeter.measurement&v=12.6` → 200; confirm the vehicle's
  `sensorState/<device>` doc updates in Firestore (telemetry, no push).
- `GET /api/shelly?vid=<vid>&event=flood.alarm` → 200; confirm an FCM push arrives and (if LinkTap creds
  are set) the valve closes. **Do this deliberately, not on a live boat.**
- If the vehicle has `sh_webhook_secret`: send **without** `&k=` → still 200 but `vehicleAuth:'unauthenticated'`
  in the response (Phase 1); send **with** the correct `&k=` → `vehicleAuth:'ok'`.
- Premium vehicle with `sh_whatsapp_prefs`/`sh_telegram_prefs` opted into `flood` → confirm the message
  provider is hit (a test send).
- `POST /api/control` with a monitor-role user's ID token → rejected; with a control/admin token → relayed.
- **LinkTap webhook** — `POST /api/linktap?t=<LINKTAP_WEBHOOK_SECRET>` with a JSON body
  `{"gatewayId":"<vehicle's lt_gateway_id>","deviceId":"<taplinker>","event":"wateringOn"}` → `200 {status:'ok'}`
  and the vehicle's `sensorState/linktap_<deviceId>` doc updates. A wrong/missing `?t=` → `401`. A
  `water cut-off alert` body → confirm a push arrives (and, if the vehicle has `lt_auto_recover`, the
  server logs a dismiss+reopen).

## Step 3 — cut over `api.boatrvguardian.com`

Cloudflare allows only one Worker per custom domain, so moving the domain is the atomic switch.

1. In the Cloudflare dashboard → Workers → **remove** the `api.boatrvguardian.com` custom domain from the
   old `boat-rv-guardian-webhooks` worker, then **add** it to `brvg-cloud-worker` (or set it in
   `brvg-cloud-server/wrangler.toml` `routes` and redeploy).
2. **Do NOT delete the old worker.** Leave `boat-rv-guardian-webhooks.<acct>.workers.dev` live — devices
   still provisioned against that hostname keep working until re-registered (Step 4).
3. Re-verify `https://api.boatrvguardian.com/api/health` and one telemetry webhook.

## Step 4 — re-register devices (on the boat / home LAN)

Devices cache their webhook URL. Open the app once on the same LAN as each device so it re-registers its
webhooks — this both (a) points them at `api.boatrvguardian.com` and (b) adds `&k=<secret>` (SEC-4).
Confirm on the device: `curl http://<ip>/rpc/Webhook.List` shows the new URL with `&k=`.

## Step 4b — register the LinkTap webhook (turns on the push pipeline)

The LinkTap event-driven pipeline (brvg-cloud-server `linktapEvents`/`linktapCore` + `/api/linktap`)
ingests LinkTap's `setWebHookUrl` callbacks — watering start/end, `flowMeterValue`, cut-off / high-low
flow / valve-broken / freeze / battery / offline — into `sensorState` + the alert pipeline.

- `setWebHookUrl` is **account-global** (one URL per LinkTap account), so register once per LinkTap
  account with `linkTapSetWebhook({username, apiKey}, 'https://api.boatrvguardian.com/api/linktap?t=<LINKTAP_WEBHOOK_SECRET>')`
  (see `brvg-cloud-server/src/linktapAccount.ts`). Use the vehicle's stored `lt_cloud_user`/`lt_cloud_key`.
- Verify a real watering session lands `sensorState/linktap_<deviceId>` updates and a cut-off pushes.
- **This is ADDITIVE and safe:** the app still talks to LinkTap cloud directly today, so nothing breaks.
  The push pipeline runs alongside it. The app-side rewrite (read state from Firestore `onSnapshot`,
  send commands via `/api/control`, stop calling LinkTap cloud, on-LAN gateway fallback) is a **separate,
  native-verify-gated** change — it's what finally retires the multi-instance race. Until then, treat
  `/api/linktap` state as an authoritative mirror for off-app / off-LAN display + alerts.
- To undo: `linkTapDeleteWebhook({username, apiKey})`.

## Step 5 — enforce SEC-4 (Phase 2)

Once every active vehicle's devices have re-registered (unauthenticated hits ~0), flip
`WEBHOOK_AUTH_REQUIRED` to `true` in `brvg-cloud-server/src/auth.ts` and redeploy. After this, a webhook
with a missing/wrong `&k=` for a secret-bearing vehicle is rejected (401). Keep the old worker until
you're confident no device still fires the pre-`&k=` URL.

## Rollback

Move the `api.boatrvguardian.com` custom domain back to `boat-rv-guardian-webhooks`. Because the new
worker shares the same Firestore, no data needs reverting.

## After cutover

- Delete the old worker once devices are migrated and a few days pass with no old-URL traffic.
- Remove the `boat-rv-guardian-webhooks` references from this repo's docs.
- Check off Task 7 in `open-tasks.md`.
