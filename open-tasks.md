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
- [ ] **Break #2 — push notifications fail (`403`).** ⬅️ **IMMEDIATE NEXT ACTION.** The worker's
      service account `linktap-worker@boat-rv-guardian-9f8a4.iam.gserviceaccount.com` has only
      `roles/datastore.user` — it lacks `cloudmessaging.messages.create`, so FCM send 403s (valve
      still closes; only the alert push is missing). FCM API is already **enabled**. **Fix = grant
      the FCM role** (was authorized-pending when the session ended):
      ```
      gcloud projects add-iam-policy-binding boat-rv-guardian-9f8a4 \
        --member="serviceAccount:linktap-worker@boat-rv-guardian-9f8a4.iam.gserviceaccount.com" \
        --role="roles/firebasecloudmessaging.admin" --condition=None
      ```
      (Or in the Cloud console: IAM → grant that SA **Firebase Cloud Messaging API Admin**.)
      Then verify: `curl "https://boat-rv-guardian-webhooks.jgearinger.workers.dev/api/shelly?vid=v_uusajkm88&device=diag&event=flood.alarm"`
      → check `wrangler tail` shows **no** `FCM send failed: 403`, and your phone gets the push.
      NOTE: re-running that curl will **close the valve** (it's a real flood replay).

- [ ] **Follow-up: `flood.alarm_off` also triggers a shutoff.** `FLOOD_EVENT_RE = /flood|leak|alarm/i`
      matches `flood.alarm_off` too, so the "dried out" event also fires a (harmless, idempotent)
      close. Consider excluding `*_off` / `*.alarm_off` from the shutoff trigger in
      [worker/src/index.ts](worker/src/index.ts) `FLOOD_EVENT_RE` / the `isFlood` check.

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
- [ ] Add a worker *unit* test gate: [worker/src/index.ts](worker/src/index.ts) inlines the
      event-classification (`FLOOD_EVENT_RE`, `*.measurement`/`*.change` telemetry skip) and the
      `sensorState` extra-param extraction. Extract those into a `worker/src/events.ts`, add Vitest
      to the worker package, and cover them. (CI currently typechecks the worker but doesn't unit-test it.)
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
  - [ ] **(Follow-up) Fix `remain_duration` unit bug**: in `normalizeCloudStatus`, the
        `totalDuration*60 - onDuration` branch mixes units (onDuration is minutes, subtracted as
        seconds). Confirm the LinkTap cloud field semantics, then correct to
        `totalDuration*60 - onDuration*60` and update the test. Low impact (only the cloud-only
        "remaining" display when `total` is absent) but worth fixing once verified.
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

- [ ] Find the local-server enable flag/default (likely a `localStorage` key + a Settings toggle;
      candidates: `LOCAL_API_SETUP.md`, Settings → Hardware Connections, `utils/*`), and flip the
      **default to off** without disabling it for users who already turned it on (migration-safe:
      only unset installs default off).
- [ ] Make sure the off-by-default path still lets self-hosters turn it on cleanly (document in
      `LOCAL_API_SETUP.md`).

---

## 6. Subscription tiers — Free / Basic / Premium

**Priority:** High (new product direction). Added 2026-06-25.
**Model:** open-source **self-hosted** (local server / self-run workers) stays free forever; the
**hosted cloud** is the paid convenience layer. **Decisions (2026-06-25):**

- **Free** — **monitor vehicles (view only, NOT control)** + **cloud settings sync/backup** +
  **vehicle sharing**. Rationale: a wife/friend/mechanic must be able to monitor the boat, and that
  requires the configs/devices to sync. Maps onto the existing Friends **`monitor`** role.
- **Basic — $3/mo or $12/yr** — adds **control** (hosted Cloudflare workers handle
  actions/triggers/timers); history retention **1 week–1 month**.
- **Premium — $5/mo or $30/yr** — history retention **1–3 years**; **SMS/voice (call) alerts** on
  specific events; **premium support**; plus future premium-only extras.

**Billing decision:** scaffold the **entitlement/gating layer + a manual tier switch now**; move to
**Stripe when going live** (do NOT build payments this round).

Tasks:
- [ ] **Rebuild the pricing page** to reflect the tiers above. *(Deferred — do NOT act this round;
      placeholder task per 2026-06-25.)*
- [ ] **Backend administrative site** to manage users, tiers/entitlements, and other admin tasks
      (see Task 12).
- [ ] Wire **Stripe** when going live (deferred; entitlement layer must be provider-agnostic so this
      is a drop-in).
- [ ] Build a **tier/entitlement layer** independent of the payment provider: an `entitlements`
      doc/claim per user (or per vehicle?), a `useEntitlements()` hook, and feature gates
      (`canUseCloudActions`, `historyRetentionDays`, `canSmsAlert`, …). Gate features by entitlement,
      not by hardcoded UI checks.
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

- [ ] Decide repo strategy: **separate public repo** vs keep in monorepo under `worker/` + extract
      later (see open questions).
- [ ] Extract a transport-agnostic core (`events.ts` etc. — overlaps Task 2 worker test gate) so the
      same logic runs on Workers and Node.
- [ ] Node/Docker adapter: `Dockerfile`, `docker-compose.yml` (server + optional local DB), env-var
      config, README for self-hosters.
- [ ] **Storage question for self-host:** Firestore requires a Google project + service-account key
      (works in Docker but ties self-hosters to Firebase). Evaluate a pluggable storage interface so
      self-host can use SQLite/Postgres while hosted uses Firestore (or migrate hosted off Firestore
      — see Task 8).
- [ ] CI: build/publish the Docker image; keep the existing `worker/**` auto-deploy for hosted.

---

## 8. Data-volume & cost analysis (backend choice)

**Priority:** High — informs Tasks 6 & 7. Added 2026-06-25.

- [ ] Model ingest volume: per device, webhook frequency × bytes. Known rates: voltmeter telemetry
      `voltmeter.measurement`/`.change` ~every 60s (per the remote-telemetry path); flood = rare
      event-driven; LinkTap usage buckets hourly. Estimate per-vehicle/day and at N vehicles.
- [ ] Estimate storage growth for history retention windows (1wk / 1mo / 1yr / 3yr) per tier and the
      Firestore read/write/storage cost at each scale.
- [ ] Compare hosted-backend options for the paid tiers: **stay Firestore** vs **Cloudflare-native**
      (Workers + D1/KV/R2 — keeps everything in one vendor, likely cheaper at this scale, and pairs
      with the self-host Docker story). Recommend one with numbers.
- [ ] Free-tier ceilings: confirm Cloudflare Workers free/paid limits and Firestore free quota
      against the projected volume; flag where a paid plan kicks in.

---

## 9. Test strategy (formalize — protect what works as dev accelerates)

**Priority:** High — explicit ask 2026-06-25: "don't break anything that works." Builds on Task 2.

- [ ] Write `docs/TESTING.md`: the testing pyramid for this repo — pure-util unit tests (have),
      worker unit tests (Task 2 gap), hook tests, light component/integration tests, and a manual
      **hardware smoke-test checklist** for the safety-critical paths (flood shutoff, valve
      open/close, poll loop) that can't be fully unit-tested.
- [ ] Define **CI gates that must pass before merge**: `tsc -b`, `npm test`, `wrangler --dry-run`,
      and (Task 7) worker tests + Docker build. Make them required.
- [ ] Add coverage reporting + a floor (don't let it regress).
- [ ] Regression guard for the **safety chain**: a worker integration test that replays a
      `flood.alarm` GET and asserts the close path + the `*.alarm_off`/telemetry exclusions
      (overlaps Task 6 follow-up and Task 2).

---

## 10. Agent coding-discipline guide

**Priority:** Medium — explicit ask 2026-06-25: better, more disciplined direction for agents.

- [ ] Write `AGENTS.md` (or expand `CLAUDE.md`) with the working contract: small reviewable
      increments; behavior-preserving refactors verified by `tsc`+tests+build each step (the Task 3
      increment pattern is the model); **no new feature without a test**; keep files under a size
      budget; commit-message + version-bump discipline (the 7-file rule); when to defer to a
      hardware smoke test; never weaken the safety chain.
- [ ] Add a PR checklist / template encoding the CI gates from Task 9.
- [ ] Note conventions: time policy (UTC store / `lt_tz` display), entitlement-gating over ad-hoc
      checks, server-side enforcement over client-only.

---

## 11. Domain migration → `boatrvguardian.com` subdomains

**Priority:** Medium — user-facing URLs should not expose vendor domains. Added 2026-06-25.
**Context:** Anything shown to the user (the cloud worker custom URL, web app, etc.) should live on
a `boatrvguardian.com` subdomain, not `*.workers.dev` / `*.web.app` / `*.github.io`.

- [ ] Inventory user-exposed URLs: `DEFAULT_WORKER_URL`
      (`boat-rv-guardian-webhooks.jgearinger.workers.dev`), the web-app host, FCM/Firebase hosts in
      configs, any links in Settings/README.
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

## Notes

- **Version bumps touch 7 files** (per CLAUDE.md): `dashboard/package.json`,
  `dashboard/src-tauri/{tauri.conf.json,Cargo.toml,Cargo.lock}`,
  `dashboard/src/pages/Settings.tsx` + `dashboard/src/components/LinkTapWidget.tsx`
  (`APP_VERSION`), `dashboard/android/app/build.gradle`. Keep them in sync on every release.
- **Build gates before release:** `npx tsc -b` + `npm run build` (dashboard),
  `npx wrangler deploy --dry-run` (worker).
</content>
</invoke>
