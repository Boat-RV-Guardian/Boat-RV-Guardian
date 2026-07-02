# SEC-4 — authenticating the hosted webhook (design proposal)

**Status: proposal, owner decision required. Not yet implemented.** From the 2026-07-02 security review.

> **Note (worker relocated):** the `worker/` directory was retired from this repo; the webhook worker
> now lives in **brvg-cloud-server** (its Cloudflare Worker adapter, `src/worker.ts`, sharing the same
> core as the self-host Node server). So SEC-4 rides the Task 7 cutover: implement the per-vehicle auth
> below in **brvg-cloud-server** as part of making its adapter the live `api.boatrvguardian.com` worker.
> The cloud-server already has fail-closed **single-instance** `?key=` auth (SEC-3); this adds the
> **per-vehicle** secret the multi-tenant hosted deployment needs.

## Problem

`GET|POST https://api.boatrvguardian.com/api/shelly?vid=<vid>&event=<event>&device=<device>` has **no
authentication** — it is keyed only by `vid` (`handleShellyWebhook` in the webhook worker). Anyone who
knows or guesses a registered `vid` can, per request:

- trigger a real **LinkTap valve close** on a `flood` event (with retry/backoff),
- fan out **FCM push** to every `allowedUsers` member, and (Premium) **Twilio SMS** — a cost-amplification
  vector, currently capped only because Twilio is a trial account,
- write attacker-controlled query params into `sensorState`.

`vid` presence is enumerable (404 vs 200). SEC-5 (path-injection via `vid`) is already fixed; this is the
remaining, larger issue.

## Why it can't just be "add auth"

Shelly devices fire a **static, pre-configured webhook URL** and **cannot send custom headers** or compute
a per-request signature — the URL is registered once during provisioning (`utils/shellyRpc.ts`
`webhookValueParams`, `ProvisionShellyModal`) with placeholders like `${ev.xvoltage}`. So:

- A true payload **HMAC is not feasible on the device** (it can't sign anything).
- Any auth must be a **static secret embedded in the URL** — exactly what the self-host server already
  does with `?key=<sh_webhook_key>` ([brvg-cloud-server](../../brvg-cloud-server/src/core.ts)); the hosted
  worker just never adopted it.
- Making auth **mandatory in one step would break every already-provisioned device** (they'd 401 until
  re-provisioned on-site), including the live flood-shutoff path. So this must be **phased**, the same way
  the Task 11 domain cutover is (devices re-register their webhooks on a successful local poll).

## Proposed scheme: per-vehicle webhook secret (URL bearer), phased

A random **`webhookSecret`** per vehicle, embedded in the device's webhook URL as `&k=<secret>` and
verified by the worker. This is a bearer secret in the URL (not HMAC) — the strongest thing Shelly can
actually send — and it defeats the real threat here: **anonymous internet vid-guessing**.

### Data
- Add `webhookSecret` to the vehicle config (auto-generated, like `sh_local_password`). It rides the
  existing per-vehicle config sync and lives in the vehicle doc the worker **already reads** for LinkTap
  creds — so verification adds **no extra Firestore read**.
- Firestore rules: it's an ordinary config field. Members already hold the vehicle's LinkTap creds, so a
  member reading the secret is not a new exposure; it defends against outsiders, not co-members.

### App / provisioning
- On (re)provisioning, append `&k=<webhookSecret>` to every registered Shelly webhook URL
  (`utils/shellyRpc.ts`). The app already re-registers webhooks on a successful local poll, which is how
  existing devices will pick up the secret (same mechanism as the Task 11 URL cutover).

### Worker
- Verify `k` against the vehicle's `webhookSecret` with a **constant-time** compare (mirror
  `brvg-cloud-server/src/auth.ts` `safeEqual`).
- **Phase 1 (additive, safe to deploy now):** accept a request if `k` is valid **OR** absent
  (backward-compatible). Count/log unauthenticated hits per vid (a `sensorState.unauthedHits` field or a
  metric) so migration progress is observable. New provisioning emits `k`; old devices keep working.
- **Phase 2 (flip to required):** once the active vehicles' devices have re-registered (unauthenticated
  hits drop to ~0), reject requests with missing/invalid `k` (401). This is an owner-timed flip, like the
  domain cutover — **do not flip while devices still fire the old URL**, or they lose away alerts + flood
  shutoff.

### Defense-in-depth (independent of the secret)
- **Rate-limit per vid** (e.g. a KV/Durable-Object counter): even a leaked secret shouldn't allow
  unbounded valve toggles / push floods.
- **Dedup + throttle repeated identical alerts** before FCM/SMS fan-out — directly caps the SMS/FCM cost
  vector (partially covered by the existing telemetry write-coalescing, but alerts are never throttled
  today).
- Keep the `sensorState` extras write bounded (cap field count/length) — a small, separate hardening.

## Rollout checklist
1. Worker Phase 1 (accept `k` or none) + constant-time verify — in **brvg-cloud-server**'s worker adapter
   (the worker's new home), landed alongside the Task 7 cutover. **owner OK** for the deploy.
2. App: generate `webhookSecret` on vehicle create + backfill; emit `&k=` on webhook registration; ship.
3. On the boat/home LAN: open the app near each device so it re-registers with `&k=`. Confirm
   `Webhook.List` shows the secret and the worker's unauthenticated-hit count for that vid goes to 0.
4. Worker Phase 2 (require `k`). **owner OK** + verify no active vehicle still fires the old URL first.
5. Add the per-vid rate limit + alert dedup (can land with Phase 1).

## Notes
- This composes with the already-fixed SEC-5 (`sanitizeVid`) and the cloud-server fail-closed auth
  (SEC-3): the self-host path already requires `?key=`; this brings the hosted worker to parity.
- Estimated effort: ~1 worker PR (Phase 1) + ~1 app PR (secret + provisioning), then a hardware pass and
  the Phase-2 flip. Phases 1–2 are each behind an owner-timed deploy.
