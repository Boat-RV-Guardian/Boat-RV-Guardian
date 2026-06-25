# Open Tasks

Working backlog for Boat & RV Guardian. Created 2026-06-23. Grounded in the current
`dashboard/`, `worker/` source and `CLAUDE.md`. Check items off as they land; keep this
file in sync with reality (delete tasks that become obsolete, like the old "split App.tsx"
note — `App.tsx` is now only 159 lines).

---

## 🚨 ACTIVE — Flood auto-shutoff safety chain (hardware-tested 2026-06-23)

On-boat hardware testing found the **entire flood→shutoff→push chain was dead in production**,
broken in **three** independent places. Two are fixed + deployed + verified; one remains.

**Verified working chain:** `Shelly flood sensor wakes → GET webhook → Cloudflare worker →
LinkTap cloud activateInstantMode(action:false) → valve closes (~16s over RF)`.

- [x] **Break #1 — worker 405'd every webhook.** Shelly fires webhooks as **GET**; the worker's
      `fetch` began with `if (method !== 'POST') return 405`, rejecting every flood alarm before the
      handler. Fixed (handle `/api/shelly` before the method check) — commit `b3fdce3`, **deployed**
      (worker version after `b9a9f014`). Confirmed: GET now 200/404 not 405.
- [x] **Break #3 — dead LinkTap endpoint.** Worker closed the valve via
      `https://www.link-tap.com/api/turnOffV2`, which **no longer exists** (returns an HTML 404).
      Switched to `activateInstantMode` w/ `action:false, duration:0` (the call the app uses) —
      commit `a6ca1c3`, **deployed** (version `7ddb792a`). Verified: replayed `flood.alarm` →
      `shutoff:{ok:true,valves:1}` → valve physically closed in ~16s. ✅
- [x] **Break #2 — push notifications fail (`403`). RESOLVED 2026-06-25.** Owner applied the FCM IAM
      grant; the safe test (`event=button.push`) returned `notified:1` with no 403. The worker now
      also reports `pushFailed` so a future 403/stale-token shows up in the response (not just a
      `notified` count). The flood→shutoff→**push** chain is now fully working end to end.
- [x] ~~**Break #2 — push notifications fail (`403`).**~~ (history below — kept for context)
      The worker SA `linktap-worker@boat-rv-guardian-9f8a4.iam.gserviceaccount.com` had only
      `roles/datastore.user` — lacked `cloudmessaging.messages.create`, so FCM send 403s (valve still
      closes; only the alert push is missing). FCM API is already **enabled**. Fix:
      ```
      gcloud projects add-iam-policy-binding boat-rv-guardian-9f8a4 \
        --member="serviceAccount:linktap-worker@boat-rv-guardian-9f8a4.iam.gserviceaccount.com" \
        --role="roles/firebasecloudmessaging.admin" --condition=None
      ```
      (Or Cloud console: IAM → grant that SA **Firebase Cloud Messaging API Admin**.)
      **SAFE verify (does NOT close the valve)** — use a non-flood, non-telemetry event so the worker
      pushes but never triggers shutoff (`isFloodShutoff` only fires on flood/leak/alarm):
      ```
      curl "https://boat-rv-guardian-webhooks.jgearinger.workers.dev/api/shelly?vid=v_uusajkm88&device=diag&event=button.push"
      ```
      → returns `shutoff:null`; `wrangler tail … --format pretty` should show **no** `FCM send failed:
      403` and your phone gets the push. (The old `flood.alarm` verify works too but **closes the
      valve** — avoid it.)

- [x] **Follow-up: `flood.alarm_off` also triggers a shutoff.** Fixed (2026-06-25, commit on main):
      new `isFloodShutoff()` in [worker/src/events.ts](worker/src/events.ts) requires the flood family
      AND excludes the `*_off`/`.off` cleared variant AND telemetry. Covered by worker unit tests.
      **Note: deploy is automatic** (push to `worker/**` triggers `worker-deploy.yml`) — confirm the
      new version is live.

### Hardware / environment facts discovered (for the next session)
- **LinkTap gateway:** IP `172.31.0.245`, Gateway ID `1485A036004B1200`, valve/TapLinker ID
  `3CC1C335004B1200`. Local API: `POST http://172.31.0.245/api.shtml` `{cmd, gw_id, dev_id}`;
  cmd 3=status, 6=open `{duration:<sec>,volume_limit,vol}`, 7=close. Responses are HTML-wrapped JSON
  (`<body>…<!--#RET-->{…}</body>`) — the app's `extractJsonFromMaybeHtml` handles it. RF actuation
  lags ~15s after `ret:0` (why the poll loop uses the optimistic `expectedWateringStateRef` lock).
- **Shelly flood sensor:** "shellyfloodg4" (Gen4), MAC `d8:85:ac:ea:39:14` ≈ `172.31.0.248`.
  **Battery, deep-sleeps → undiscoverable by scan/poll**; only wakes to POST its webhook. Trigger
  for testing = bridge/wet the probes ("lick the wires").
- **Vehicle id (Firestore):** `v_uusajkm88`. **Worker SA:** `linktap-worker@…`. **Worker:**
  `boat-rv-guardian-webhooks` at `…jgearinger.workers.dev` (deploy: `cd worker && npx wrangler deploy`;
  CI also deploys on push to `worker/**`). Boat LAN is `172.31.0.0/16`, this Mac was `172.31.0.254`.
- **⚠️ VALVE LEFT CLOSED** after the flood test (safe state for an unattended boat). Reopen via the
  app (or `cmd 6`) if water is needed.
- **gcloud** installed at `~/google-cloud-sdk` on the *boat* Mac (run with
  `CLOUDSDK_PYTHON=$(which python3)`), authed as `jgearinger@sc4tech.com`. This auth does NOT travel
  to another machine — re-auth (`gcloud auth login`) or use the Cloud console there. `wrangler` is
  also authed on the boat Mac only.

---

## 1. Verify remote telemetry on hardware (from CLAUDE.md `⚠️ OPEN`)

**Priority:** High — built but never hardware-tested.
**Context:** The Shelly Plus Uni voltmeter remote-telemetry path was written off-site on a
foreign LAN and never confirmed against real hardware. Source of truth is the
`⚠️ OPEN — verify on the HOME network` section in [CLAUDE.md](CLAUDE.md).

- [ ] On the home Wi-Fi (192.168.86.x) with the Shelly Plus Uni reachable, open the app once
      so it re-registers webhooks on a successful local poll.
- [ ] `curl http://<uni-ip>/rpc/Webhook.List` and confirm hooks for
      `voltmeter.measurement` / `voltmeter.change` carry `&v=${ev.xvoltage}&vraw=${ev.voltage}`
      and the correct `cid` (voltmeter cid = 100, flood = 0).
- [ ] Confirm the worker writes `vehicles/{vid}/sensorState/{shellyDeviceId}` with `v`/`vraw`
      fields, refreshing ~every 60s.
- [ ] Confirm off-LAN the battery widget shows voltage. If wrong, inspect
      `webhookValueParams` / `cidFor` in [shellyRpc.ts](dashboard/src/utils/shellyRpc.ts)
      (placeholder syntax `${ev.X}` or cid is the likely culprit).

---

## 2. Stand up an automated test suite (currently zero tests)

**Priority:** High — there is no test framework and no test files anywhere in the repo, so
every change is verified by hand. Start with pure logic that's high-risk and easy to cover.

**Status (2026-06-23): framework stood up, 35 tests passing across 5 util modules.** Vitest 4
(supports Vite 8) + jsdom, config in [vitest.config.ts](dashboard/vitest.config.ts), a
Map-backed localStorage shim in [src/test/setup.ts](dashboard/src/test/setup.ts), tests excluded
from the production `tsc -b`. Run with `npm test` (or `npm run test:watch`).

- [x] Add Vitest to `dashboard/` — `npm test` / `npm run test:watch` wired in
      [package.json](dashboard/package.json).
- [x] Unit-test the time policy in [utils/time.ts](dashboard/src/utils/time.ts)
      (`formatTime` / `formatDate` / `formatDateTime` — UTC storage, `lt_tz` display, fallbacks).
- [x] Unit-test the threshold/config migrations in
      [utils/configSync.ts](dashboard/src/utils/configSync.ts)
      (`migrateAllVehiclesThresholds`, `migrateFlatThresholds`, freshness checks, round-trip).
- [x] Unit-test role resolution in [utils/sharing.ts](dashboard/src/utils/sharing.ts)
      (`getMyRole`, legacy-member-as-admin, `getMembers`).
- [x] Unit-test the Shelly webhook param builders in
      [utils/shellyRpc.ts](dashboard/src/utils/shellyRpc.ts) (via `registerShellyWebhooks` /
      `refreshLocalShellyWebhooks` — value params, cid resolution, merge cap) — ties into Task 1.
- [x] Unit-test history merge logic in [utils/historySync.ts](dashboard/src/utils/historySync.ts)
      (per-month bucketing, usage = max per bucket). **Found + fixed a real bug**: a non-finite
      event `ts` (NaN/Infinity passes `typeof === 'number'`) threw `RangeError` and aborted the
      whole push — now guarded with `Number.isFinite`.
- [x] Wire `npm test` into CI so PRs run it — [.github/workflows/ci.yml](.github/workflows/ci.yml)
      runs dashboard typecheck + unit tests and the worker wrangler dry-run on every PR / push to main.
- [x] Add a worker *unit* test gate (2026-06-25): extracted event-classification + `sensorState`
      extra-param extraction into [worker/src/events.ts](worker/src/events.ts), added Vitest to the
      worker package (12 tests), and wired `npm test` into the worker CI job. Also the foundation for
      the shared self-host core (Task 7).
- [ ] (Follow-up) Add component/integration tests for the role-gating UI behavior once Task 3
      extracts the logic into hooks (easier to test in isolation than the current big components).

---

## 3. Break up the two oversized files

**Priority:** Medium — refactor for maintainability; no behavior change. Do this *after*
Task 2 has at least smoke coverage so the refactor is verifiable.

- [ ] **[Settings.tsx](dashboard/src/pages/Settings.tsx) — 2154 lines.** Split into per-section
      panels (Account, Vehicles, Devices/Batteries, Hardware Connections, etc.). Each section is
      already a visually distinct block; extract into `pages/settings/` child components with a
      thin `Settings.tsx` shell. Watch the `APP_VERSION` constant — it's one of the 7 version
      locations listed in CLAUDE.md.
- [ ] **[LinkTapWidget.tsx](dashboard/src/components/LinkTapWidget.tsx) — 1818 lines.** Pull the
      non-UI logic into hooks: polling/state, the Flooding Sentry automation, Tank-Fill / Wash-Down
      / Delayed-Start flows, and the usage-history + event-log persistence. Keep the `displayTz`
      `settings_updated` refresh and the monitor-role command gating intact (both documented in
      CLAUDE.md). This file also holds an `APP_VERSION` copy — keep it in sync.
  - [x] **Increment 1** (2026-06-23): extracted the transport helpers (`isTauriEnv`, `invokeTauri`,
        `listenTauri`, `unifiedFetch`) plus two pure parsing helpers (`extractJsonFromMaybeHtml`,
        `coerceWateringBool`) into [utils/linktapHttp.ts](dashboard/src/utils/linktapHttp.ts) with
        6 new tests. 1819 → 1734 lines, build + tests green.
  - [x] **Increment 2** (2026-06-23): extracted status normalization into
        [utils/linktapStatus.ts](dashboard/src/utils/linktapStatus.ts) — `normalizeCloudStatus`
        (cloud→native shape), `swapBatterySignal`, `pickTargetVolume`, `pickTargetDuration` — with
        8 new tests (49 total). Behavior preserved; tsc + tests green. **Surfaced a latent quirk**
        (not changed, behavior-neutral refactor): the cloud `remain_duration` fallback
        `totalDuration*60 - onDuration` subtracts `onDuration` (minutes) as raw seconds. See follow-up.
  - [x] **(Follow-up) Fix `remain_duration` unit bug** — DONE 2026-06-25. Corrected the
        `totalDuration*60 - onDuration` branch to `*60` (both fields are minutes) in
        [utils/linktapStatus.ts](dashboard/src/utils/linktapStatus.ts); updated the test that had
        locked the buggy 1790 value to 1200.
  - [x] **Increment 3** (2026-06-23): extracted usage-history + Event Sentry Log state, the 4
        persistence/cloud-sync effects, and `addLog` into
        [hooks/useDeviceHistory.ts](dashboard/src/hooks/useDeviceHistory.ts) (also now owns the
        `AlertLog` type). Widget destructures `{ usageHistory, setUsageHistory, logs, addLog }`.
        Verified with tsc + **full `vite build`** + the suite (49 tests). 1819 → 1645 lines so far.
  - [x] **Increment 4** (2026-06-23): extracted the ~85-line canvas flow-chart rendering into
        [utils/flowChart.ts](dashboard/src/utils/flowChart.ts) (`drawFlowChart` + the `FlowData`
        type), with 4 new tests using a stub 2D context (53 total). 1645 → 1559 lines.
  - [ ] **Increment 5+ (higher risk — defer until hardware smoke-test possible)**: polling loop →
        hook; command senders (start/stop) → hook; Flooding Sentry + auto-restart + washdown
        automation → hook. These touch the poll closure and the
        `commandersRef`/`stateRef`/`expectedWateringStateRef` state machine, which can't be fully
        verified by tsc/build/tests alone — best done when the app can be run against a live gateway.

---

## 4. Harden monitor-role enforcement (server-side)

**Priority:** Low / future — noted as a known limitation in CLAUDE.md.
**Context:** Role enforcement is currently client-side only. A `monitor`-role user who has the
vehicle's cloud credentials could still call the device API directly.

- [ ] Route control commands through the [worker](worker/src/index.ts) so the server enforces
      role, rather than gating only in [LinkTapWidget.tsx](dashboard/src/components/LinkTapWidget.tsx).

---

## 5. Local server OFF by default

**Priority:** Medium — product/UX default change. Added 2026-06-25.
**Context:** Today the local/self-hosted server path appears to default ON. Product direction:
the **default experience is the hosted cloud (paid tiers)**; the local/self-hosted server is the
open-source opt-in. So the local server toggle should ship **off** for new installs.

- [x] **Done (2026-06-25).** The flag is `lt_local_server` (the on-device Shelly webhook listener).
      Flipped its default read from `!== 'false'` (on) to `=== 'true'` (off) in
      [Settings.tsx](dashboard/src/pages/Settings.tsx) and
      [useSensorBridge.ts](dashboard/src/hooks/useSensorBridge.ts). Migration-safe: a one-time check
      in [main.tsx](dashboard/src/main.tsx) sets it to `'true'` for existing installs (any prior
      `lt_*` config) so they aren't silently disabled; new installs get OFF.
- [x] **Done.** Documented the opt-in default in [LOCAL_API_SETUP.md](LOCAL_API_SETUP.md).
      (`lt_is_local_polling` / `lt_is_cloud_polling` for LinkTap are separate and still auto-enable
      from configured creds/IP — untouched.)

---

## 6. Subscription tiers — Free / Basic / Premium

**Priority:** High (new product direction). Added 2026-06-25.
**Model:** open-source **self-hosted** (local server / self-run workers) stays free forever; the
**hosted cloud is the paid product**. **The matrix is encoded in
[utils/entitlements.ts](dashboard/src/utils/entitlements.ts).** Refined decisions (2026-06-25):

**Key reframe:** separate remote **view** (monitor) from remote **control** (act). "Control" =
LOCAL control is always free; the gated thing is REMOTE (off-LAN) control. "Automation" = CLOUD
automation run by the worker (the in-app Flooding Sentry while the app is open is local & free).

- **Free** — **manual remote view** (pull-only: open app + tap "Update", throttled ~once / 3 min,
  band 2–5 min; **no notifications, no auto-refresh**), cloud settings sync, vehicle sharing, local
  control + local flood shutoff. Telemetry persisted ~every 30 min (cheap).
- **Basic — $3/mo · $12/yr** — automatic remote view + **remote control** + away push + **cloud
  flood-shutoff fallback** + **essential automation** (timers/schedules, single-condition rules) +
  ~1 month history. Telemetry ~every 5 min. **1-month free trial** (see trial task).
- **Premium — $5/mo · $30/yr** — high-res telemetry (~1 min) + **1–3 yr history + CSV export** +
  **advanced automation** (conditional/chained, sequences, away-mode) + **SMS/voice escalation** +
  **integrations** (Home Assistant / MQTT / IFTTT / webhooks) + season reports + priority support.

**"Plex" sharing model:** entitlements are PER-VEHICLE — the vehicle owner pays and people they share
that vehicle with inherit its tier *when accessing that vehicle*. (The scaffold already does this:
`getVehicleTier` reads the vehicle doc, which every shared user resolves against.)

**Telemetry resolution is a tier axis** (`telemetryResolutionSec`): the worker PERSISTS less often
for lower tiers — controls the dominant cost (per docs/COST_ANALYSIS.md §5) AND is an upgrade reason.

**Safety model (owner, 2026-06-25):** the LinkTap valve only opens with a volume/duration **limit**,
so it can't run long enough to sink the boat — *that limit* is the real safeguard. The flood→shutoff
automation is a **convenience** (closes it sooner). **Decided: the cloud flood-shutoff fallback stays
Basic — NOT offered free as a safety goodwill** (the valve already prevents the catastrophe). Also,
the owner expects the **valve/flood feature to be the LEAST-used** of the product — so don't
over-invest in it; prioritize monitoring / remote-view / history / alerts, which get used far more.

**Billing decision:** scaffold the **entitlement/gating layer + a manual tier switch now**; move to
**Stripe when going live** (do NOT build payments this round).

Tasks:
- [x] **Pricing page + copy alignment — PR open 2026-06-25:**
      [website-boatrvguardian#1](https://github.com/Boat-RV-Guardian/website-boatrvguardian/pull/1)
      (separate Astro repo). New `/pricing` (Free/Basic/Premium cards + comparison table + per-vehicle
      "Plex" note + 1-mo trial + self-host=free + FAQ), nav/footer link, and aligned the stale "free
      for everyone / free and always will be" copy (footer, devices, homepage) to "app + self-host
      free; hosted cloud optional paid." **Awaiting owner review/merge.** Rows mirror `TIER_FEATURES`/
      `TIER_PRICING` — keep in sync; upgrade links use the `UPGRADE_PORTAL_URL` placeholder.
  - [ ] **Follow-up:** decide whether to tier-qualify capability copy on the homepage/features pages
        (e.g. "Instant cloud alerts" is a Basic+ feature) — left as-is for now (pricing page is the
        tier source of truth).
- [x] **In-app plan indicator (2026-06-25):** compact `PlanBadge` in Settings → Vehicles shows the
      active vehicle's tier + an Upgrade link (to `UPGRADE_PORTAL_URL`) when not Premium. Replaced the
      verbose in-app feature panel (owner: keep the comparison on the website).
- [ ] **Backend administrative site** to manage users, tiers/entitlements, and other admin tasks
      (see Task 12).
- [x] **MOCK billing (2026-06-25):** [utils/billing.ts](dashboard/src/utils/billing.ts) — coupon
      codes (`GUARDIANBASIC/PREMIUM/FREE`) set the active vehicle's `tier` via `setActiveVehicleTier`
      (the single seam Stripe will drive). In-app **/account portal**
      ([pages/Account.tsx](dashboard/src/pages/Account.tsx)) for testing the entitlement flow before
      real CC. `tier` is now a synced per-vehicle config field.
- [ ] Wire **Stripe** when going live (deferred per owner; entitlement layer is provider-agnostic +
      `setActiveVehicleTier` is the drop-in seam — Stripe webhook → setActiveVehicleTier).
- [x] **Scaffolded + refined 2026-06-25 (provider-agnostic, additive, tested, 16 tests):**
      [utils/entitlements.ts](dashboard/src/utils/entitlements.ts) — `Tier` + `AutomationLevel`,
      full `TIER_FEATURES` matrix (remote view manual-only/throttle, remote control, away push, cloud
      flood-shutoff, automation level, telemetry resolution, history, export, integrations, sms,
      support), `getVehicleTier`/`getEntitlements`/`tierAtLeast`/`automationAtLeast`, `BASIC_TRIAL_DAYS`,
      labels + pricing. [hooks/useEntitlements.ts](dashboard/src/hooks/useEntitlements.ts) returns the
      active vehicle's entitlements reactively (mirrors the role pattern; `lt_vehicle_tier` stashed by
      SyncModal + `tier_updated` event). **Legacy/unset vehicles grandfather to `premium` so this
      changes NO behavior yet** — see GRANDFATHERED_TIER. Gate features off the booleans, not ad-hoc.
- [ ] **1-month free Basic trial** — grant new users/vehicles 30 days of Basic, tracked **per-user
      AND per-vehicle** (anti-abuse: can't farm trials via new vehicles or re-adding). Resolve trial
      server-side (worker/admin) and write `tier='basic'` for the trial window with an expiry; the
      client matrix needs no change (it reads `tier`). **Decided (2026-06-25): record eligibility at
      `users/{uid}.trialsUsed[]` (vehicle ids the user has already trialed) + `vehicles/{vid}.trialEndsAt`
      (expiry).** A trial is allowed only when the vid isn't in the user's `trialsUsed` AND the
      vehicle has no prior `trialEndsAt`.
- [x] **Plan panel (2026-06-25):** [pages/settings/SubscriptionPanel.tsx](dashboard/src/pages/settings/SubscriptionPanel.tsx)
      — read-only per-vehicle plan + feature checklist (pure `entitlementSummary`/`formatRetention`,
      tested), rendered in Settings → General. First real `useEntitlements` consumer + an instance of
      the Task 3 panel-split pattern. Browser-verified (renders, reacts to `tier_updated`, no errors).
- [x] **First functional gate (2026-06-25):** cloud-history toggle disabled for tiers with no
      retention (free) — inert under grandfathering. See [Settings.tsx](dashboard/src/pages/Settings.tsx).
- [ ] **Remaining gates:** LinkTapWidget honors `canRemoteControl` off-LAN (needs the local-vs-remote
      seam — best with hardware), hide SMS-alert config unless `canSmsAlert` (no SMS UI yet). Drop
      GRANDFATHERED_TIER to a real default once the admin override + Stripe exist.
- [ ] Enforce server-side in the worker too (history retention pruning, action/trigger handling,
      SMS send) — client gating is advisory only (cf. Task 4 monitor-role lesson).
- [ ] History retention enforcement: prune monthly rollups beyond the tier window (worker cron or
      on-write TTL). Ties to Task 8 cost analysis.
- [ ] SMS/voice alerts (Premium): provider (Twilio?) + per-event opt-in UI + worker send path.
- [x] **Decided (2026-06-25): entitlements are PER-VEHICLE.** The vehicle carries the tier; everyone
      who accesses it (owner + shared monitors) gets that vehicle's features. Matches the "the boat is
      Premium" mental model and the sharing goal (a shared mechanic sees the owner's history).
- [ ] **SMS/voice = scaffold only (decided 2026-06-25):** per-event opt-in UI + a Premium-gated
      worker send-path interface, **no live provider** (Twilio dropped in later).

---

## 12. Backend administrative site

**Priority:** Medium-High (new, 2026-06-25). Needed to operate the paid service.
**Context:** Manage users, view/set tiers & entitlements, support tasks, and monitoring. Lives on a
`boatrvguardian.com` subdomain (Task 11), auth-gated to admins only.

- [x] **Decided (2026-06-25): separate web app** on `admin.boatrvguardian.com`, admin-only auth.
      Keeps the consumer app lean and the attack surface separate. *(Scaffold deferred until the
      entitlement layer + cost-analysis backend choice land; spec stands now.)*
- [ ] Admin-only auth (custom claim / allowlist), audit logging of admin actions.
- [ ] User list + per-user/per-vehicle entitlement override (the manual "set tier" switch that
      backs Task 6's scaffold-first billing), device/vehicle counts, history usage.
- [ ] Operational views: worker health, recent webhook traffic, FCM/SMS send status.

---

## 7. Separate webhooks/actions server — repo, Docker, self-host

**Priority:** High (enables Task 6). Added 2026-06-25.
**Context:** The worker (`worker/`) must become a deployable, **self-hostable** product so the
open-source story is real. Cloudflare Workers don't run in Docker directly; a self-host build is
typically a Node server (or `workerd`). Likely outcome: a **shared core** (event classification,
LinkTap/Shelly relay, entitlement checks) with two thin adapters — Cloudflare Worker + Node/Docker.

**Design written 2026-06-25 → [docs/SELF_HOST.md](docs/SELF_HOST.md)** (shared core + thin adapters +
pluggable storage; 5-step migration). ⚠️ **Implementation deferred on purpose:** the worker is the
LIVE flood-shutoff path and **auto-deploys on push to `worker/**`** — do the refactor when it can be
hardware smoke-tested, not unattended.

**MAJOR UPDATE 2026-06-25:** rather than refactor the LIVE worker, the self-host server was built
**greenfield** in its own repo — **PR
[brvg-cloud-server#1](https://github.com/Boat-RV-Guardian/brvg-cloud-server/pull/1)** (awaiting owner
merge). This delivers most of increments 2/3/5 at once, safely (no live-worker change):

- [x] **Increment 1 DONE:** pure core started in-worker — [events.ts](worker/src/events.ts).
- [x] **Increment 2 DONE (greenfield):** DI core (`core.ts`) with injected `Storage`/`Notifier`/
      `LinkTapClient`; `events.ts`/`linktap.ts`/`notify.ts`/`storage.ts` as separate modules.
      **Shutoff decision covered end-to-end with mocked deps (15 tests)** — the safety regression the
      backlog wanted, now possible because it's greenfield + injectable.
- [x] **Increment 3 DONE (greenfield):** Node HTTP adapter (`GET|POST /api/shelly`, `/healthz`),
      Dockerfile (multi-stage) + docker-compose + `.env.example`, and the basic-auth **`/admin`** page
      (instance API key, retention, vehicles w/ LinkTap creds, user→FCM tokens). Runtime smoke OK.
- [x] **Increment 5 DONE:** lives in **brvg-cloud-server** (its own repo).
- [x] **History + retention DONE (2026-06-25, cloud-server PR #2):** tier-based telemetry history
      (free 0 / basic 30d / premium ~3y), retention pruning + 5000-sample cap, admin `retentionDays`
      as a self-host cap, and `GET /api/history`. Memory/File storage; 21 tests.
- [x] **Hourly downsampling DONE (2026-06-25, cloud-server main):** raw samples for 7 days, then
      one-per-hour for older data (`downsampleHistory`, tested) — bounds the premium ~3y window.
- [ ] **Increment 4 (remaining):** `SqliteStorage`/`D1Storage` behind the `Storage` interface (today:
      Memory + File JSON). Native-dep or `node:sqlite` (experimental) tradeoff — defer until needed at scale.
- [ ] **Follow-up:** a Cloudflare adapter sharing this core, then unify with / retire the live worker;
      CI in brvg-cloud-server (tsc + tests + docker build); hardware smoke of the real LinkTap/FCM calls.
- [x] **App wiring DONE (2026-06-25):** `registerShellyWebhooks` appends `&key=<sh_webhook_key>` for
      custom servers (default hosted worker gets none); worker `RESERVED_PARAMS` now drops `key` so an
      auth key is never stored as telemetry. All 3 PRs (cloud-server #1, website #1/#2) merged.

---

## 8. Data-volume & cost analysis (backend choice)

**Priority:** High — informs Tasks 6 & 7. Added 2026-06-25.
**DONE 2026-06-25 → [docs/COST_ANALYSIS.md](docs/COST_ANALYSIS.md)** (pricing verified against vendor
pages). **Recommendation: Cloudflare-native (Workers + D1)** for hosted paid-tier data; keep Firebase
Auth + FCM. One $5/mo Workers plan ≈ 100+ vehicles vs Firestore out-of-pocket past ~3–7. **Mandatory
design rule: downsample telemetry** (raw recent window, hourly aggregates long-term).

- [x] Model ingest volume (4 devices/vehicle, 60s telemetry = ~2,900 webhooks/day/vehicle; that
      telemetry is the entire cost driver).
- [x] Estimate storage growth per retention window — raw 60s = ~84 MB/yr/vehicle (trap);
      downsampled hourly = ~1.4 MB/yr/vehicle (non-issue).
- [x] Compare Firestore vs Cloudflare D1/KV/R2 with numbers → D1 recommended (SQLite also fits the
      Docker self-host story).
- [x] Free-tier ceilings confirmed: Firestore Spark ~3–7 vehicles; Cloudflare free ~17–34/day;
      Cloudflare $5/mo ~100 vehicles.
- [ ] **Follow-up to act on:** implement telemetry downsampling + vehicle-doc caching + write
      coalescing in the worker (cost levers §5) when building the history feature (Task 6).

---

## 9. Test strategy (formalize — protect what works as dev accelerates)

**Priority:** High — explicit ask 2026-06-25: "don't break anything that works." Builds on Task 2.

- [x] **Done 2026-06-25:** [docs/TESTING.md](docs/TESTING.md) — testing pyramid, run commands, CI
      gates table, "what every change adds", and the hardware smoke-test checklist.
- [x] **Done:** worker unit-test gate added to CI (Task 2). The four required gates are documented.
- [x] **Done (partial):** safety-chain regression — `isFloodShutoff` unit tests assert the
      `*.alarm_off`/telemetry exclusions. Expand toward the worker handler as it's made injectable.
- [x] **Coverage reporting added (2026-06-25):** `npm run test:coverage` (v8) in dashboard + worker;
      `coverage/` gitignored; baseline ~63% lines (dashboard). **Floor still TODO** — add a CI
      threshold once the baseline stabilizes.
- [ ] Make the CI checks **required** via branch protection (repo setting — owner action).
- [ ] Add the Docker image build to CI once Task 7 lands.

---

## 10. Agent coding-discipline guide

**Priority:** Medium — explicit ask 2026-06-25: better, more disciplined direction for agents.

- [x] **Done 2026-06-25:** [AGENTS.md](AGENTS.md) — 12-point working contract (small increments,
      no feature without a test, gates-green-before-done, server-side enforcement, never weaken the
      safety chain, time policy, per-vehicle entitlements, file-size budget, 7-file version rule,
      subdomain rule, commit conventions).
- [x] **Done:** PR template at [.github/pull_request_template.md](.github/pull_request_template.md)
      encoding the four CI gates + safety check.
- [x] **Done:** conventions captured in AGENTS.md.

---

## 11. Domain migration → `boatrvguardian.com` subdomains

**Priority:** Medium — user-facing URLs should not expose vendor domains. Added 2026-06-25.
**Context:** Anything shown to the user (the cloud worker custom URL, web app, etc.) should live on
a `boatrvguardian.com` subdomain, not `*.workers.dev` / `*.web.app` / `*.github.io`.

- [x] **Done 2026-06-25 → [docs/DOMAIN_MIGRATION.md](docs/DOMAIN_MIGRATION.md)**: inventoried the
      user-exposed URLs (the critical one is `DEFAULT_WORKER_URL` in
      [configSync.ts:75](dashboard/src/utils/configSync.ts), baked into Shelly devices), wrote the
      cutover order (attach custom domain → verify → flip → re-register; keep old route live), and
      the exact Cloudflare DNS records the owner must add. **No code flipped** (flipping
      `DEFAULT_WORKER_URL` before the custom domain is attached would break webhooks).
- [x] **Decided (2026-06-25): `api.` = worker, `app.` = web app, `admin.` = admin site. Domain IS on
      Cloudflare**, so a Worker custom domain can be attached; I prep the config + exact DNS records,
      owner applies DNS.
- [ ] Add the Cloudflare Worker **custom domain/route**; update `DEFAULT_WORKER_URL` and any
      hardcoded references; keep `sh_webhook_url` per-vehicle override working.
- [ ] Document the required **DNS records** the owner must add (DNS access is owner-only; I can
      prepare code + the exact records but can't change DNS).
- [ ] Re-register Shelly webhooks against the new URL once cut over (devices cache the old URL until
      a successful poll re-registers — cf. CLAUDE.md).

---

## 13. In-app auto-update (Tauri updater) — needs owner-generated signing certificate

**Priority:** Medium. Added 2026-06-25. **Requires the owner to generate a signing key/certificate.**
**Context:** Today releases are built+published by `release.yml` on a tag, but the desktop app doesn't
auto-update — users re-download. Add the Tauri updater so the native app checks for and installs
updates in-app. (The app already surfaces a "latestVersion" in Settings → Updates; this wires the
real updater behind it.)

- [ ] **Owner action:** generate the updater signing keypair (`npm run tauri signer generate` /
      `tauri signer generate`) and store the **private key + password as CI secrets**
      (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`); put the **public key** in
      `tauri.conf.json` `plugins.updater.pubkey`.
- [ ] Add `@tauri-apps/plugin-updater` (+ `plugin-process` for relaunch); configure
      `plugins.updater` with the endpoint(s) and pubkey.
- [ ] Publish an **update manifest** (`latest.json`) + the signed bundles from `release.yml` (the
      updater action can generate these), served from a stable URL (a `boatrvguardian.com` subdomain
      or the GitHub release assets) — ties into Task 11.
- [ ] Wire the in-app check/prompt/install flow (reuse the Settings → Updates surface); test the
      full update across a version bump. Keep the 7-file version-bump rule in sync.
- [ ] Android updates go through Play, not the Tauri updater — scope this to desktop (Mac/Win).

---

## 14. Web user portal — subscription management (+ account)

**Priority:** High (gates real billing). Added 2026-06-25. This is the **end-user** web portal the
app links to via `UPGRADE_PORTAL_URL` (currently `app.boatrvguardian.com/account`) — distinct from
the **operator** admin site (Task 12) and the **self-host** admin page (Task 7).

**Decided (2026-06-25): in-app `/account` view** (state-routed, not a URL — the app is an SPA). **v1
built with MOCK coupon billing** ([pages/Account.tsx](dashboard/src/pages/Account.tsx)): shows the
active vehicle's plan + feature list and redeems coupon codes to set the tier. Real Stripe is the
drop-in later (Stripe Checkout + Customer Portal; webhook → `setActiveVehicleTier`).

**Core (subscription management):**
- [x] **View the vehicle's plan + feature list (done, Account.tsx).** Change plan via coupon (mock).
- [ ] Real upgrade/downgrade/cancel, monthly⇄yearly (Stripe).
- [ ] **Per-vehicle assignment** (billing is per-vehicle / "Plex"): choose which vehicle a
      subscription applies to; manage multiple vehicles; (future) fleet/multi-vehicle discount.
- [ ] **Trial** status + days left; enforce per-user+per-vehicle eligibility (ties to Task 6 trial).
- [ ] Payment method, **invoices/receipts**, billing history (via Stripe Customer Portal).

**Recommended additions (my suggestions — confirm scope):**
- [ ] **Notification channels:** add/verify **phone number(s) for SMS/voice** (Premium) and manage
      push devices — these are account-level and don't belong in per-device settings.
- [ ] **Integrations/API tokens** (Premium): issue/rotate tokens for Home Assistant / MQTT / webhooks.
- [ ] **Data & privacy:** export history (Premium), delete data, see retention window; **delete
      account** (GDPR/Play/App-Store requirement).
- [ ] **Usage vs plan:** storage used, device/vehicle counts, telemetry resolution in effect.
- [ ] **Sharing overview** (read-only mirror of the app's Friends): who has access to each vehicle.
- [ ] **Account basics:** email, password/SSO, display name; **priority-support** entry for Premium.
- [ ] Receipts/billing emails (transactional email provider) — note: there's currently "no email
      service" (see CLAUDE.md sharing); billing will need one (Stripe can send receipts).

---

## Follow-ups (small)

- [ ] **Shelly password-set during provisioning — AP & BLE paths.** Done for the **manual-IP** path
      (best-effort `shellyChangePassword` as the last step). The **Wi-Fi-AP** path has an ordering
      hazard (securing the device would 401 the subsequent unauthenticated `Wifi.SetConfig`), and
      **BLE** goes through `bleProvision`. Wire both to set the vehicle `sh_local_password` on pairing
      — needs hardware to get the ordering right. (See `ProvisionShellyModal.tsx`.)
- [ ] **Verify `shellyChangePassword` on hardware.** The Settings "Edit→Save" flow pushes the new
      password to every Shelly device (`Shelly.SetAuth`); the digest path in `shellyRpc.ts` is
      HARDWARE-UNTESTED. A wrong/failed SetAuth can lock a device out (factory reset to recover).
      Sleeping battery sensors will fail until they next wake — the UI reports per-device results.

## Notes

- **Version bumps touch 7 files** (per CLAUDE.md): `dashboard/package.json`,
  `dashboard/src-tauri/{tauri.conf.json,Cargo.toml,Cargo.lock}`,
  `dashboard/src/pages/Settings.tsx` + `dashboard/src/components/LinkTapWidget.tsx`
  (`APP_VERSION`), `dashboard/android/app/build.gradle`. Keep them in sync on every release.
- **Build gates before release:** `npx tsc -b` + `npm run build` (dashboard),
  `npx wrangler deploy --dry-run` (worker).
</content>
</invoke>
