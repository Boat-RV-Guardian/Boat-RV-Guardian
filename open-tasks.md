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
- [~] (Follow-up) Component/integration tests for the gating UI — **started 2026-06-26** now that
      Task 3 extracted the panels: RTL tests for `AccountPanel` (entitlement gate: cloud-history
      toggle disabled with an "upgrade" note when the tier has no retention),
      `AdvancedDeviceSettingsPanel` (battery-threshold round-to-0.1 + flip-to-custom; shore fields
      don't flip), `SoftwareUpdatesPanel`, and `NotificationsPanel`. **Extended 2026-06-28 (PR #16):**
      both-path RTL tests for the Account SMS + integrations Premium gates (free → upgrade note + hidden
      inputs; Premium → inputs render). **Remaining (only):** the monitor-role command gating lives in
      `LinkTapWidget`, not Settings — cover it when that widget's logic is pulled into hooks (Task 3
      increment 5+, hardware-gated).

---

## 3. Break up the two oversized files

**Priority:** Medium — refactor for maintainability; no behavior change. Do this *after*
Task 2 has at least smoke coverage so the refactor is verifiable.

- [ ] **[Settings.tsx](dashboard/src/pages/Settings.tsx) — 2321 → 833 lines (−64%).** All render
      sections live in `pages/settings/` child components (pure presentational, value/onChange props —
      the `LocalServerPanel` pattern) behind a thin shell; persistence + sharing + LinkTap-discovery
      logic moved to tested utils/hooks. Watch the `APP_VERSION` constant — one of the 7 version
      locations (CLAUDE.md).
  - [x] **2026-06-25:** extracted the battery-preset table into a tested pure util
        [utils/batteryPresets.ts](dashboard/src/utils/batteryPresets.ts) (6 tests), then **twelve**
        presentational panels under `pages/settings/`: `SoftwareUpdatesPanel`, `NotificationsPanel`,
        `AdvancedDeviceSettingsPanel` (DRY `VoltageField`), `FriendsPanel`, `LinkTapAuthPanel`,
        `SettingsModals` (DRY `ModalOverlay`), `VehiclesPanel`, `AccountPanel`, `DeviceConfigPanel`,
        `DevicePreferencesPanel` (takes NotificationsPanel as children), `AddDevicePanel`.
  - [x] **Persistence centralized + tested:** the ~55 `lt_*`/`sh_*` keys + defaults lived in THREE
        drifting copies (initial state, rehydrate effect, writer effect) → unified into pure
        [utils/settingsStorage.ts](dashboard/src/utils/settingsStorage.ts) (`readSettings`/
        `writeSettings`, 4 round-trip/defaults/trim tests). Surfaced a latent bug (rehydrate omits 4
        notification toggles the writer persists) — **preserved** here, flagged as its own task.
  - [x] **Logic → hooks/utils:** the Friends-tab brain moved to
        [hooks/useVehicleSharing.ts](dashboard/src/hooks/useVehicleSharing.ts) (state + derived
        roles/members + the invite/member handlers), the LinkTap-discovery brain to
        [hooks/useLinkTapDiscovery.ts](dashboard/src/hooks/useLinkTapDiscovery.ts) (cloud-retrieve +
        LAN-scan actions + the dropdown/scan UI state), and the pure Shelly addressing helpers
        (`deviceLocalHost` mDNS-fallback + `findVoltmeterId`) to a tested
        [utils/shellyDevice.ts](dashboard/src/utils/shellyDevice.ts) (7 tests). Plus RTL component
        tests for 4 panels (see Task 2 follow-up). All gates green (tsc + 113 tests + build).
  - [ ] **(Intentionally left — not clean-extractable without risk)** the remaining ~833 lines are:
        (a) the **~56 synced-settings `useState` + the two coupled effects** (the `settings_updated`
        rehydrate + the localStorage writer, sharing the `syncDispatchRef` re-entry guard). A
        `useSettingsState` hook could own these + init from `readSettings()` (killing the last
        duplicated list), but the state is interleaved with non-synced UI state and the two effects
        straddle settings + vehicle/device/connection state — refactor-risky for a ~112-name return
        and modest line gain; do it with a click-through pass. (b) the **device/password handlers**
        (firmware check/update, voltmeter enable+calibration, Shelly SetAuth, per-device removal) —
        live device RPC (voltmeter-enable *reboots* the device); per AGENTS.md, **defer until a
        hardware smoke test**. (c) vehicle switch/add/delete + manual-sync handlers, entangled with the
        synced-settings setters and cloud-config writers.
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

- [x] **Server-side enforcement DONE + DEPLOYED (2026-06-27, PR #4).** New `POST /api/control` in
      [worker/src/index.ts](worker/src/index.ts) verifies the caller's Firebase ID token (sig/iss/aud/exp),
      resolves their role from the vehicle's `members` map (pure `resolveRole`/`canControl` in
      [worker/src/authz.ts](worker/src/authz.ts), 12 tests), and rejects `monitor` with 403. Enforces the
      open-requires-limit safety invariant server-side too; relays to LinkTap with the vehicle's stored
      creds (never exposed to clients). The flood-shutoff close path is untouched. Live: `/api/control` =
      401 on no token.
  - [ ] **Client wiring (remaining, hardware-gated):** route LinkTapWidget's OFF-LAN control through
        `/api/control` (sending the user's ID token) instead of calling LinkTap directly. Touches the
        safety-critical poll/command state machine — do with a live gateway (cf. Task 3 inc 5+). The
        endpoint is inert until this lands.

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
Basic — NOT offered free as a safety goodwill** (the valve already prevents the catastrophe).
**Prioritization (revised 2026-06-29):** treat the **valve/flood feature like any other sensor** —
neither more nor less important. (Supersedes the earlier "LEAST-used, don't over-invest" note; the
safety model is unchanged — this is only about UI prominence / effort allocation.)

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
  - [x] **Follow-up DONE 2026-06-30 (website#6):** tier-qualified the Features page (remote control,
        away push, cloud auto-shutoff fallback → hosted Basic/Premium; local control + local auto-shutoff
        free; "self-host every feature free") and fixed the stale "advanced features may become paid down
        the road" line. Homepage was already qualified in its alerts section.
- [x] **In-app plan indicator (2026-06-25):** compact `PlanBadge` in Settings → Vehicles shows the
      active vehicle's tier + an Upgrade link (to `UPGRADE_PORTAL_URL`) when not Premium. Replaced the
      verbose in-app feature panel (owner: keep the comparison on the website).
- [x] **Backend administrative site** to manage users, tiers/entitlements, and other admin tasks —
      DONE, see Task 12 (brvg-admin-site, live at brvg-tools.sc4tech.com). Stale duplicate entry, removed.
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
      SyncModal + `tier_updated` event). **Default tier is now `free` (`DEFAULT_TIER`, 2026-06-28 owner
      decision — was `premium` while grandfathering; no users to grandfather pre-launch).** A new vehicle
      starts Free; gates are now live. Gate features off the booleans, not ad-hoc.
- [~] **1-month free Basic trial** — **built end to end (2026-06-28): predicate + `/api/trial`
      endpoint (#9), consumer auto-grant (#10), admin re-trial guard (admin-site#1).** Only native-app
      verification of the auto-grant remains. Original spec below. Grant new users/vehicles 30 days of
      Basic, tracked **per-user AND per-vehicle** (anti-abuse: can't farm trials via new vehicles or re-adding). Resolve trial
      server-side (worker/admin) and write `tier='basic'` for the trial window with an expiry; the
      client matrix needs no change (it reads `tier`). **Decided (2026-06-25): record eligibility at
      `users/{uid}.trialsUsed[]` (vehicle ids the user has already trialed) + `vehicles/{vid}.trialEndsAt`
      (expiry).** A trial is allowed only when the vid isn't in the user's `trialsUsed` AND the
      vehicle has no prior `trialEndsAt`.
  - [x] **Eligibility predicate landed (2026-06-28):** the decided anti-abuse rule is now the pure,
        tested `isTrialEligible(vid, userTrialsUsed, vehicleTrialEndsAt)` in
        [worker/src/retention.ts](worker/src/retention.ts) (allows only when the vid is absent from the
        user's `trialsUsed` AND the vehicle has never carried a `trialEndsAt` — an expired one still
        blocks), plus `trialEndsAtFrom(now)` + `BASIC_TRIAL_DAYS`. Worker tests cover the allow/block matrix.
  - [x] **Server-authoritative grant endpoint landed (2026-06-28):** `POST /api/trial` in
        [worker/src/index.ts](worker/src/index.ts) (`handleTrial`) verifies the caller's Firebase ID
        token, requires they be the vehicle **owner (admin role)**, then applies `isTrialEligible`
        against authoritative Firestore state and — only if eligible — writes `tier='basic'` +
        `trialEndsAt` to the vehicle AND appends the vid to `users/{uid}.trialsUsed` (both via masked
        PATCH). Ineligible callers get `{granted:false}` (idempotent). The daily cron already lapses it
        back to `free` at expiry. Enforcement is server-side so the client can't bypass the anti-abuse
        rule by skipping the `trialsUsed` write. Smoke-check after deploy: `/api/trial` = 401 on no token.
  - [x] **Trial is OPT-IN, not auto-granted (2026-06-28 owner decision).** A new vehicle defaults to
        Free; the user starts the 30-day Basic trial explicitly via a **"Start free trial"** button in
        the Account portal ([pages/Account.tsx](dashboard/src/pages/Account.tsx) → `onStartTrial` →
        `requestTrial` → `/api/trial`), shown only when signed in + tier is Free + no prior trial. On
        grant the UI optimistically stashes `lt_vehicle_tier=basic` + `lt_vehicle_trial_ends` for instant
        feedback (the cloud snapshot re-confirms). The old SyncModal auto-grant + `lt_trial_attempted_*`
        flag were removed. ~~Client auto-grant (PR #10).~~
  - [x] **Admin "Start trial" eligibility-gated (2026-06-28, admin-site#1):** the console warns +
        records `override:true` when re-trialing an already-trialed vehicle (`isVehicleTrialEligible`).
  - [x] **Optimistic local stash on grant — DONE (2026-06-28):** `onStartTrial` writes
        `lt_vehicle_tier`/`lt_vehicle_trial_ends` + fires `tier_updated` so the UI flips to Basic
        immediately instead of waiting on the snapshot.
  - [ ] **Remaining:** native-app verification of the opt-in "Start free trial" flow (signed-in,
        Free vehicle → button grants Basic + ~30 days; an already-trialed vehicle is declined).
- [x] **Plan panel (2026-06-25):** [pages/settings/SubscriptionPanel.tsx](dashboard/src/pages/settings/SubscriptionPanel.tsx)
      — read-only per-vehicle plan + feature checklist (pure `entitlementSummary`/`formatRetention`,
      tested), rendered in Settings → General. First real `useEntitlements` consumer + an instance of
      the Task 3 panel-split pattern. Browser-verified (renders, reacts to `tier_updated`, no errors).
- [x] **First functional gate (2026-06-25):** cloud-history toggle disabled for tiers with no
      retention (free) — inert under grandfathering. See [Settings.tsx](dashboard/src/pages/Settings.tsx).
- [~] **Remaining gates:** ~~hide SMS-alert config unless `canSmsAlert`~~ **DONE 2026-06-28 (PR #12,
      #16)** — the Account SMS + integrations sections are Premium-gated with upgrade notes, covered by
      both-path RTL tests. Still open: LinkTapWidget honors `canRemoteControl` off-LAN (needs the
      local-vs-remote seam — hardware-gated). ~~Drop GRANDFATHERED_TIER to a real default~~ **DONE
      2026-06-28** — default is now `DEFAULT_TIER='free'`; gates are live for new vehicles.
- [~] Enforce server-side in the worker too — **history-retention pruning + trial expiry DONE**
      (2026-06-27, PR #3, daily cron); action/trigger handling + SMS send still TODO. Client gating
      stays advisory only (cf. Task 4 monitor-role lesson).
- [x] **History retention enforcement DONE + DEPLOYED (2026-06-27, PR #3).** Daily worker cron
      (`12 4 * * *` in [wrangler.toml](worker/wrangler.toml)) prunes monthly rollups beyond each
      vehicle's tier window AND lapses expired Basic trials (`trialEndsAt` past → `tier='free'`). Pure
      selectors in [worker/src/retention.ts](worker/src/retention.ts) (14 tests). Inert under
      grandfathering (legacy→premium keeps all) until real tiers are assigned; per-run delete cap.
- [x] **SMS/voice alerts (Premium) — LIVE 2026-06-30.** per-event opt-in UI (#12) + worker send path (#11)
      + `dispatchSmsForEvent` wired into the alert path (#31) + a real **Twilio `SmsSender`** (#37,
      [worker/src/sms.ts](worker/src/sms.ts) `twilioSmsSender`/`smsSenderFromEnv`) + the three Twilio
      secrets set via `wrangler secret put` (TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM; creds validated against
      the Twilio API). A Premium vehicle with an opted-in event + a Twilio-**verified** destination now
      gets a real SMS. ⚠️ Owner rotated the Auth Token after setup — if so the worker secret must hold the
      NEW token (re-run `wrangler secret put TWILIO_AUTH_TOKEN`). End-to-end delivery not yet test-fired
      (needs a verified destination cell).
- [x] **Decided (2026-06-25): entitlements are PER-VEHICLE.** The vehicle carries the tier; everyone
      who accesses it (owner + shared monitors) gets that vehicle's features. Matches the "the boat is
      Premium" mental model and the sharing goal (a shared mechanic sees the owner's history).
- [~] **SMS/voice = scaffold only (decided 2026-06-25):** per-event opt-in UI + a Premium-gated
      worker send-path interface, **no live provider** (Twilio dropped in later).
  - [x] **Worker send-path interface landed (2026-06-28):** [worker/src/sms.ts](worker/src/sms.ts) —
        `SmsSender` interface + `noopSmsSender` (sends nothing, reports not-configured), pure
        `canSmsAlertForTier` (Premium-only, mirrors `canSmsAlert`) + `smsRecipientsForEvent`
        (Premium AND per-event opt-in, dedup/trim) + `dispatchSmsForEvent` (attempted/sent counts).
        11 tests; unwired (changes no behavior) until a provider + the opt-in UI land.
  - [x] **Account-portal per-event opt-in UI landed (2026-06-28, PR #12):** Premium-gated SMS section
        in Account.tsx (phone numbers + per-event escalation) → synced `sh_sms_prefs`; pure
        [utils/smsPrefs.ts](dashboard/src/utils/smsPrefs.ts) (tested).
  - [x] **Wiring DONE (#31) + Twilio provider LIVE (#37, secrets set 2026-06-30):** `dispatchSmsForEvent`
        runs in the alert path via `smsSenderFromEnv(env)` → `twilioSmsSender` when the TWILIO_* secrets are
        present (else noop). `smsEventKey` (raw Shelly event → catalog key) + `parseSmsPrefs` read the
        vehicle's synced `sh_sms_prefs`. Done.

---

## 12. Backend administrative site

**Priority:** Medium-High (new, 2026-06-25). Needed to operate the paid service.
**Context:** Manage users, view/set tiers & entitlements, support tasks, and monitoring. Lives on a
`boatrvguardian.com` subdomain (Task 11), auth-gated to admins only.

- [x] **Decided (2026-06-25): separate web app** on `admin.boatrvguardian.com`, admin-only auth.
      Keeps the consumer app lean and the attack surface separate.
- [x] **Built 2026-06-26 — folded into the website repo (owner's call), PR
      [website-boatrvguardian#3](https://github.com/Boat-RV-Guardian/website-boatrvguardian/pull/3).**
      Static, client-side console at `/admin`: Firebase Google sign-in + an `admin` **custom claim**
      gate, vehicle list, per-vehicle **tier setter** (free/basic/premium) writing `vehicles/{vid}.tier`
      directly, and an append-only `adminAudit` entry per change. **Enforcement is server-side via
      Firestore rules** (admin read + tier-only update + adminAudit) — added to the consolidated rules
      in [CLAUDE.md](CLAUDE.md). Auth model **decided with owner**: custom claim + direct Firestore
      writes (no new backend). Bootstrap script `scripts/grant-admin.mjs` + owner runbook
      `docs/ADMIN.md` in the website repo. **Owner steps before live:** add Firebase authorized
      domains, publish the rules, grant the first admin claim.
- [x] **Follow-ups built 2026-06-26 (same PR website#3) — now a 3-tab console:**
      - **Vehicles:** tier override (the "set tier" switch backing Task 6) + **trial management**
        (Start a 30-day Basic trial → `tier=basic` + `trialEndsAt`; Clear → removes `trialEndsAt`;
        both inside the rules' tier-only allowlist).
      - **Users:** one row per unique member aggregated across every vehicle's `members` map (email +
        roles), enriched from `users/{uid}` for trials-used + FCM-token presence (needs the `/users`
        admin read clause — added to CLAUDE.md rules).
      - **Operations:** telemetry-freshness from the worker-written `sensorState` across all vehicles
        (last webhook per device; >6h flagged) — the data-driven worker-health signal (needs the
        `sensorState` admin read clause — added to CLAUDE.md rules).
- [x] Audit logging of admin actions (`adminAudit` collection, append-only).
- [x] **Operators tab + add/revoke admins (2026-06-27):** the one privileged backend — a Cloudflare
      **Pages Function** `functions/api/operators.ts` (verifies the caller's Firebase ID token w/ jose,
      requires `admin===true`, then list/grant/revoke via Identity Toolkit). Console **Operators** tab.
      Secrets set on the Pages project. Smoke-verified in prod (`/api/operators` = 401 on no/bad token).
- [x] **DEPLOYED + LIVE (2026-06-27):** rules deployed, `admin` claim → jgearinger@gmail.com,
      authorized domains updated, website on Pages prod → **https://boatrvguardian.com/admin**. See the
      2026-06-27 session handoff in [CLAUDE.md](CLAUDE.md) for the exact production state + credentials.
- [x] **Worker `/api/health` for the live ops signal — MERGED + DEPLOYED (2026-06-27, PR #1).** The
      Operations tab pings it; live `/api/health` returns 200. The "Worker: down" state is cleared.
- [x] **🔴 New users / logins didn't appear in the Users tab — FIXED (2026-06-28, two parts).**
      Root cause: there was **no user registry** — the Users tab was built only from vehicles' `members`
      maps, so a signed-in account with no vehicle (or a new vehicle that only had `allowedUsers`) was
      invisible. Fixes: **(consumer)** every sign-in now merge-writes a `users/{uid}` profile
      (`buildLoginProfile` in [utils/userProfile.ts](dashboard/src/utils/userProfile.ts), wired in
      App.tsx `onAuthStateChanged`); the new-vehicle cloud push now also seeds the owner into `members`
      via `ensureOwnerAdmin`. **(admin-site)** the Users tab reads the `/users` collection as its base
      overlaid with membership (`loadUsers` in `src/scripts/adminData.ts`), falling back to membership
      if `/users` isn't listable. ⚠️ **Deploy:** admin-site auto-deploys on merge to `main`; the `/users`
      admin read clause is already in the published rules. **Sign-up vs login separation is still open
      (Task 15)** — Google sign-in still auto-creates accounts.
- [~] **Admin delete user / vehicle (2026-06-29).** Console Vehicles + Users tabs now have a
      confirm-gated **Delete** button (brvg-admin-site `deleteVehicleDoc` / `deleteUserData` +
      `adminConsole`). User-delete mirrors the consumer policy (solo-owned vehicles deleted, shared ones
      dropped, `users/{uid}` removed). **Needs the updated Firestore rules deployed** (admin `delete` on
      /vehicles + /users, admin update of members/allowedUsers — added to `firestore.rules` + CLAUDE.md;
      owner runs `firebase deploy --only firestore:rules`). **Remaining:** deleting the **Firebase Auth
      account** itself needs the privileged backend (Identity Toolkit + the pending Pages Function SA
      secrets) — until then a deleted user could sign in again and re-create a `users/{uid}` doc.
- [x] **Still server-backed-only:** FCM/SMS send-success status (send logs aren't stored anywhere
      queryable). Needs the worker to persist send results. Low priority. **Implemented in
      [Boat-RV-Guardian#42](https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/pull/42)** — worker
      writes a `lastSend` field to `sensorState/{device}`; still pending owner merge (`worker/**`
      auto-deploys to prod on push to `main`).
- [x] **RELOCATED to its own repo + domain — LIVE 2026-06-28.** The console moved OFF the consumer
      brand domain into a dedicated repo **[Boat-RV-Guardian/brvg-admin-site](https://github.com/Boat-RV-Guardian/brvg-admin-site)**,
      deployed as its own Cloudflare Pages project at **https://brvg-tools.sc4tech.com** (obfuscation/
      security). The marketing site dropped `/admin` + `/api/operators`
      ([website#4](https://github.com/Boat-RV-Guardian/website-boatrvguardian/pull/4), merged). Agent
      did the Pages deploy + `FIREBASE_PROJECT_ID` secret + custom-domain attach; owner created the
      CNAME and `brvg-tools.sc4tech.com` was added to Firebase Auth authorized domains (via
      `gcloud auth print-access-token` + Identity Toolkit `admin/v2/config`, header
      `x-goog-user-project: boat-rv-guardian-9f8a4`). **Google sign-in works → console usable.**
- [x] **Owner (Operators tab only) — DONE 2026-07-01.** Set the 2 Pages Function secrets
      `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` on the `brvg-admin-site` project (generated a
      fresh Firebase SA key, set both via `wrangler pages secret put`, redeployed — Pages Functions
      needed a fresh deploy to bind the new secrets, setting them alone wasn't enough). Verified live:
      the Operators tab loads cleanly (was `Cannot read properties of undefined (reading 'replace')`
      from `saToken()` in [functions/api/operators.ts](functions/api/operators.ts) hitting an unset
      `FIREBASE_PRIVATE_KEY`). Downloaded SA key file deleted after use.

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
- [x] **Increment 4 DONE (brvg-cloud-server#3):** `SqlStorage` over a tiny `SqlDriver` seam
      ([src/sql.ts](https://github.com/Boat-RV-Guardian/brvg-cloud-server/blob/main/src/sql.ts)) +
      `NodeSqliteDriver` (node:sqlite, self-host) + `D1Driver`
      ([src/d1.ts](https://github.com/Boat-RV-Guardian/brvg-cloud-server/blob/main/src/d1.ts)) behind
      the `Storage` interface (Memory + File JSON remain for dev). Verified present 2026-06-28.
- [x] **Cloudflare adapter + CI DONE:** a Cloudflare Worker adapter reusing the core
      ([src/worker.ts](https://github.com/Boat-RV-Guardian/brvg-cloud-server/blob/main/src/worker.ts)),
      and CI (`.github/workflows/ci.yml`) already runs **tsc + tests + build + docker build**. Verified
      2026-06-28.
- [ ] **Follow-up (remaining):** unify with / retire the main repo's live `worker/` (owner-driven
      cutover via the Firestore storage + Cloudflare adapter); hardware smoke of the real LinkTap/FCM calls.
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
- [~] **Follow-up to act on:** cost levers §5 — telemetry downsampling (tier-aware persist throttle,
      already shipped), **OAuth-token + vehicle-doc caching DONE + DEPLOYED (2026-06-27, PR #2,
      [worker/src/cache.ts](worker/src/cache.ts))** — every webhook had been minting a fresh OAuth token
      + re-reading the vehicle doc; both now reuse the isolate cache (flood path bypasses for fresh
      creds). **Write coalescing DONE (2026-06-28):** for periodic telemetry, the worker now skips a
      `sensorState` write whose content is unchanged since this isolate last wrote it
      (`shouldWriteTelemetry`/`sensorStateSignature` in [worker/src/cache.ts](worker/src/cache.ts)),
      bounded by a 15-min heartbeat so `at` stays fresh. Telemetry-only — alerts/flood always write.
      Layered on top of the existing throttle; zero extra Firestore reads (uses an isolate cache).

---

## 9. Test strategy (formalize — protect what works as dev accelerates)

**Priority:** High — explicit ask 2026-06-25: "don't break anything that works." Builds on Task 2.

- [x] **Done 2026-06-25:** [docs/TESTING.md](docs/TESTING.md) — testing pyramid, run commands, CI
      gates table, "what every change adds", and the hardware smoke-test checklist.
- [x] **Done:** worker unit-test gate added to CI (Task 2). The four required gates are documented.
- [x] **Done (partial):** safety-chain regression — `isFloodShutoff` unit tests assert the
      `*.alarm_off`/telemetry exclusions. Expand toward the worker handler as it's made injectable.
- [x] **Coverage reporting added (2026-06-25):** `npm run test:coverage` (v8) in dashboard + worker;
      `coverage/` gitignored.
- [x] **CI coverage floor added (2026-06-26):** conservative global regression-guard thresholds in
      [vitest.config.ts](dashboard/vitest.config.ts) (lines/stmts 55, branches/funcs 50 — a few points
      below the current ~59% baseline) enforced by switching the CI dashboard step to
      `npm run test:coverage`. Raise / add per-module thresholds as the untested IO modules gain tests.
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
- [x] **Worker custom domain ATTACHED + LIVE 2026-06-30 (PRs #38/#39/#40):** `api.boatrvguardian.com`
      is a Workers Custom Domain on this worker (Cloudflare-managed DNS + cert; verified `/api/health`
      over HTTPS) and is config-managed in [worker/wrangler.toml](worker/wrangler.toml) `routes`. Done via
      `wrangler deploy` (zone `boatrvguardian.com` is in the sc4tech CF account `9b75…`). Gotcha for next
      time: the CI deploy token (`CLOUDFLARE_PAGES_EDIT` = the "Boat-RV-Guardian GitHub Actions - Deploy"
      token) needed **Zone → Workers Routes:Edit** added (a route in config 401s CI otherwise); that perm
      is now granted, CI deploy is green. Additive — `*.workers.dev` stays live.
- [ ] **Flip `DEFAULT_WORKER_URL`** (configSync.ts) to `https://api.boatrvguardian.com` + keep the
      `sh_webhook_url` per-vehicle override. ⚠️ HARDWARE-GATED ordering: do NOT flip before...
- [ ] **Re-register Shelly webhooks** against the new URL after the flip (devices cache the old URL
      until a successful poll re-registers — needs the devices on-LAN). These two are the cutover.
- [ ] **`app.` (web app) + `admin.` (admin site)** subdomains — Cloudflare *Pages* custom domains
      (different from the worker); attachable now that the deploy token has zone perms. Lower priority.

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
- [x] **Trial status + usage-vs-plan + data export (2026-06-28).** Account.tsx now shows trial
      days-left (from the SyncModal-stashed `lt_vehicle_trial_ends`), a "Usage & limits" section
      (telemetry resolution / hosted history / device + vehicle counts), and a **Premium-gated CSV
      export** of on-device usage history. Pure logic in
      [utils/accountSummary.ts](dashboard/src/utils/accountSummary.ts) +
      [utils/historyCsv.ts](dashboard/src/utils/historyCsv.ts) (tested); Account RTL tests cover the
      new sections. Gates green (tsc + 128 tests + build).
- [ ] Real upgrade/downgrade/cancel, monthly⇄yearly (Stripe).
- [~] **Per-vehicle assignment** (billing is per-vehicle / "Plex"): choose which vehicle a
      subscription applies to; manage multiple vehicles; (future) fleet/multi-vehicle discount.
      **DONE 2026-06-28 (read-only, PR #14):** Account.tsx "Your vehicles & plans" lists every local
      vehicle with its resolved tier + marks the active one (`vehiclePlanRows`, tested).
      **In-portal switching DONE (2026-06-30):** each non-active row gets a "Switch" button that
      lazy-imports `VehicleManager.switchVehicle` (keeping Account.tsx's static import surface light,
      same pattern as the Firebase lazy-imports elsewhere in this file) — `useEntitlements` already
      re-renders on the `settings_updated` event `switchVehicle` dispatches, so the whole view reflects
      the new active vehicle with no extra plumbing. Remaining: real multi-vehicle billing (Stripe).
- [x] **Trial status + days left (2026-06-28).** Account.tsx shows trial days-left; server-side
      per-user+per-vehicle eligibility is enforced by the worker (`isTrialEligible` + `/api/trial`,
      Task 6) and the consumer auto-grant (#10) / admin guard (admin-site#1).
- [ ] Payment method, **invoices/receipts**, billing history (via Stripe Customer Portal).

**Recommended additions (my suggestions — confirm scope):**
- [x] **Notification channels — DONE 2026-06-28 (PR #12).** Premium-gated SMS/voice opt-in in
      Account.tsx (phone numbers + per-event escalation), stored in the synced `sh_sms_prefs`. Decided
      per-vehicle (matches per-vehicle entitlements + the worker's SmsPrefs shape). Push-device
      management still TODO.
- [x] **Integrations/API tokens — DONE 2026-06-28 (PR #15).** Premium-gated issue/mask/revoke in
      Account.tsx, stored in the synced `sh_api_tokens`. Scaffold — no server validates them yet.
- [x] **Data & privacy — delete-account DONE 2026-06-28 (PR #18, verify in native app).** Account.tsx
      "Delete account" (type-DELETE-to-confirm); pure plan+executor in
      [utils/accountDeletion.ts](dashboard/src/utils/accountDeletion.ts) (solo-owned → delete, shared →
      leave; tested). CSV export + retention window already shown (export = Premium). ⚠️ irreversible +
      Firebase-coupled — verify the `requires-recent-login` re-auth path in the native app.
- [x] **Usage vs plan — DONE (2026-06-28).** "Usage & limits" section (telemetry resolution, hosted
      history, device + vehicle counts) via `usageRows`.
- [ ] **Sharing overview** (read-only mirror of the app's Friends): who has access to each vehicle.
      **Deferred:** needs a live cloud member feed (Firestore listener) that doesn't fit Account.tsx's
      deliberately Firebase-free design without a test harness, AND it's largely redundant with the
      existing **Settings → Friends** tab. Low marginal value vs coupling cost.
- [~] **Account basics — DONE 2026-06-28 (PR #14); display-name editing DONE 2026-06-29.** Account.tsx
      shows the signed-in display name + email + a Premium priority-support line (via a `user` prop). The
      display name is now **editable** in place — pure/tested `checkDisplayName`/`saveDisplayName`
      ([utils/displayName.ts](dashboard/src/utils/displayName.ts)) + a dedicated lazy-Firebase
      [EditDisplayName](dashboard/src/components/EditDisplayName.tsx) component (updates the Auth profile,
      best-effort mirrors `users/{uid}.displayName` for the admin Users tab). Remaining: editing
      *password/SSO*. ⚠️ Native-verify the actual Auth `updateProfile` write.
- [ ] Receipts/billing emails (transactional email provider) — note: there's currently "no email
      service" (see CLAUDE.md sharing); billing will need one (Stripe can send receipts).

---

## 15. Onboarding & auth UX (found 2026-06-28 via native testing)

**Priority:** High — these block clean account testing and are first-run polish gaps.

- [x] **Separate Sign Up from Login — DONE (v1.0.46).** [pages/Login.tsx](dashboard/src/pages/Login.tsx)
      now has an explicit `isLogin` mode toggle: login with a non-existent email errors "No account
      found…" (no silent register), sign-up is the deliberate alternate action, and federated (Google)
      sign-in enforces the same rule via `enforceMode` (a brand-new Google `isNewUser` in login mode is
      undone + told to switch to Sign Up).
- [x] **No-vehicle screen sign-out — DONE (2026-06-28).** Added a "Sign out" button to the logged-in
      no-vehicle onboarding screen ([App.tsx](dashboard/src/App.tsx)) so you're no longer stuck on
      "Create a Vehicle".
- [~] **"Create a local-only account" option + cloud-mode switch.** Per the **Configuration sync model**
      (CLAUDE.md, 2026-06-29): **config sync is hosted-cloud-only**; encourage cloud, fall back to local/self-host.
  - [x] **Local-only mode on the login screen — DONE (2026-06-29).** A "📱 Use this device only (local
        mode, no account)" button stamps a synthetic `local:<rand>` owner
        ([utils/userScope.ts](dashboard/src/utils/userScope.ts) `enterLocalMode`); the session is isolated
        + persists offline (the null-user launch event no longer wipes it) and **never touches the cloud**
        (all cloud paths require a Firebase user). Signing into a real account from local mode wipes the
        local session (clean switch); "Use a cloud account instead" exits local mode. 4 tests.
  - [~] **In-app Settings → "Switch to cloud mode"** (for a local user who already has vehicles). **No
        hybrid accounts (owner, 2026-06-29) — a device is EITHER cloud OR local, device-wide.** Two sanctioned
        transitions, both total: **(a) Rebuild** — sign into cloud, wipe the local session, rebuild vehicles
        fresh (this is already what `applyUserScope` does on cloud sign-in from local); **(b) Migrate** — a
        "migrate local account to the cloud" flow that uploads the local vehicles to the new cloud account,
        then switches the device to cloud mode. Never leave a mix of local + cloud vehicles on one device.
    - [x] **Rebuild path exposed in-app — DONE (2026-06-29).** Settings → Account is now local-mode-aware
          ([AccountPanel.tsx](dashboard/src/pages/settings/AccountPanel.tsx) `localMode` prop): a local user
          sees a "You're in local-only mode" section with a **discard warning** (pure, tested
          `cloudSwitchDiscardNote` in [utils/accountMode.ts](dashboard/src/utils/accountMode.ts) — "your N
          vehicles stay on this device, not uploaded") and a **"Switch to a cloud account"** button that opens
          the inline Login. Signing in drives the existing `applyUserScope` wipe+reload = the rebuild. RTL
          tests cover the branch. ⚠️ Native-verify the actual local→cloud sign-in/reload cycle.
    - [x] **Migrate path (upload local vehicles, then switch) — DONE (2026-06-30).** New pure
          [utils/migrateLocalToCloud.ts](dashboard/src/utils/migrateLocalToCloud.ts) stashes the local
          vehicles map under a `brvg_pending_local_migration` key (deliberately OUTSIDE the `lt_`/`sh_`
          namespace `clearUserScopedData` wipes) BEFORE sign-in is triggered, since the sign-in wipe +
          hard-reload happen almost immediately after. AccountPanel now offers a second, confirm-gated
          "Migrate my vehicles to the cloud" button next to the rebuild one (`cloudSwitchDiscardNote`
          copy updated to distinguish the two). After the forced reload, a new effect in
          [SyncModal.tsx](dashboard/src/components/SyncModal.tsx) detects the stash once a real cloud
          user is present and re-runs the same `updateVehicleConfig` + `ensureOwnerAdmin` pipeline a
          brand-new vehicle uses, `markSessionCreated`-protecting each vehicle synchronously (before any
          network round trip) so the PR #34 cloud-authoritative prune can't mistake an in-flight migrated
          vehicle for a stale one and delete it. A vehicle is dropped from the stash only once its
          upload is confirmed; a failure leaves it (and anything after it) staged and surfaces a
          retryable error banner. 23 new tests (pure module fully covered; SyncModal's Firestore-coupled
          wiring is deliberately untested, matching this repo's established pattern). ⚠️ Native-verify
          with a throwaway account before the next release — this is a real account-data-affecting flow.
  - [x] **Private/self-host server does NOT sync config — VERIFIED 2026-06-29.** Audited every reader of
        `sh_webhook_url`/`sh_webhook_user`/`sh_webhook_key`: they appear only in the Shelly webhook relay
        ([ProvisionShellyModal.tsx](dashboard/src/components/ProvisionShellyModal.tsx)), the worker action
        base ([utils/trial.ts](dashboard/src/utils/trial.ts)), Settings UI state, and as synced config
        *data*. Configuration sync itself is Firestore-only ([hooks/useCloudConfig.ts](dashboard/src/hooks/useCloudConfig.ts)
        `onSnapshot`/`setDoc`; SyncModal → `applyCloudVehicleConfig`) — no `fetch()` carries config to any
        custom server. Documented the invariant at the sync entry point so it can't silently regress.
- [~] **Verify/fix cloud sync of newly-created vehicles in native dev** (open from this session): a boat
      created in the native app may not be writing to Firestore. Confirm via the admin Vehicles tab;
      if missing, capture the exact Firestore write error (in-app error surface) and fix. Distinct from
      the members-map gap below. **Hardened 2026-06-29 (PR #34):** new vehicles are now tracked as
      `markSessionCreated` so SyncModal reliably pushes them (and the new cloud-authoritative prune won't
      drop an in-flight new vehicle). ⚠️ Still native-verify that a freshly-created boat appears in the
      admin Vehicles tab.

## ⚠️ Account/sync bugs found in native testing 2026-06-29 — FIXED (native-verify pending)

All three were found by the owner running the native app; merged to `main`, gate-green, but not yet
native-verified. See the CLAUDE.md "Session handoff — 2026-06-29 (late)" for the full writeup.
- [~] **Delete-account orphaned data (#32):** Auth login was deleted even when the Firestore deletes
      failed → boats + user doc left behind a dead account. Fixed: Auth deleted LAST, only if data
      cleanup fully succeeded; else abort + stay signed in to retry.
- [~] **Cross-account boat leak (#33):** a new-user login showed a previous account's boats.
      `applyUserScope` now reloads whenever it actually wiped data (was `wiped:false` on first sign-in).
- [~] **Admin deletes didn't stick / resurrection (#34):** logging in re-pushed stale local config,
      re-creating admin-deleted vehicles. Fixed: only push session-created vehicles + cloud-authoritative
      prune of stale local entries.
- [x] **Deleted account can still LOG IN — FIXED 2026-07-01.** Was: admin delete removed the Firestore
      docs but not the Firebase Auth account. Unblocked by the Operators-tab SA secrets landing
      (`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY`); shipped a new `functions/api/users.ts` Pages
      Function (brvg-admin-site) that deletes the Auth account via Identity Toolkit, wired into the
      Users-tab delete flow AFTER the existing Firestore cleanup (data first, Auth login removed last —
      mirrors the consumer app's own account-deletion ordering). Verified live end-to-end against a
      disposable throwaway account: deleted via the console, confirmed sign-in afterward returns
      "No account found for that email."

## 16. Interface / layout rethink (requested 2026-06-28)

**Priority:** Medium — explicit owner ask: step back and rethink the app's UI/layout holistically
(navigation, information hierarchy, onboarding, settings density, the dashboard/sensor pages) rather
than continuing to bolt panels on. Produce a proposed layout/IA before refactoring. Ties into Task 15
(onboarding) and Task 3 (component structure already extracted, so the render layer is movable).

- [~] **Proposal v1 written 2026-06-29; owner-reviewed + answers folded in → [docs/UI_IA_PROPOSAL.md](docs/UI_IA_PROPOSAL.md).**
      Inventories the current flat-6-tab IA, names the structural problems (uneven prominence — the valve
      gets its own primary tab while sensors are split across 4 tabs; two overlapping account surfaces;
      Settings is a junk drawer; buried vehicle switcher; no first-class Alerts), and proposes a target IA
      (global bar with vehicle switcher + account menu; 4 primary destinations Overview/Systems/Alerts/Settings;
      **valve treated as a peer sensor under Systems**, per owner). Owner approved building it all (bottom
      tab bar on mobile; Alerts includes push-channel mgmt). 6-step incremental, gate-green migration that
      re-parents the already-extracted panels.
  - [x] **Migration steps 1–6 SHIPPED 2026-06-29 (PRs #25–#28); VERIFIED LIVE in-browser 2026-06-30.**
        global bar with vehicle switcher + account button (#25); Systems shell consolidating the 4
        sensor/valve tabs with the valve as a peer, always-mounted to keep the Flooding Sentry running (#26);
        4-item nav Overview/Systems/Alerts/Settings (#26); Alerts v1 — merged event timeline + current-issues
        banner (#27); Account = identity + mode home (sign-out + Cloud/Local mode + switch-to-cloud) (#28).
        Clicked through the whole shell in Chrome (signed in as sc4tech) — all render, no console errors;
        vehicle switcher + display-name edit + section nav all work. **Found+fixed a real bug live:** the
        mobile bottom tab bar sat below the fold (app shell `height:100%` vs `#root` only `min-height:100vh`)
        → fixed with `height:100dvh` (#36), re-verified the bar pins at 380px.
  - [~] **Remaining (deferred, with reason):** (a) relocate the notification toggles + SMS prefs into Alerts
        and remove the Settings→Account sign-in/sync duplication — these are wired into Settings' ~56-field
        synced-settings state machine. **The `useSettingsState` hook extraction was ATTEMPTED 2026-06-30 and
        REVERTED:** the 56 synced `useState` are scattered/interleaved across the 800-line Settings.tsx, so
        the surgery is high-risk for the just-stabilized sync layer and pure internal cleanup (the panel
        "move" only removes a non-harmful duplication). Do it only as a dedicated, native-verified pass; the
        Alerts page already links to notification prefs, so the user-facing need is met. ~~(b) mobile bottom-tab-bar
        styling~~ **DONE 2026-06-29 (PR #30)** — bottom tab bar ≤640px, top row on desktop (`useIsMobile`).

## 17. Vehicle ownership & type (2026-06-29)

- [x] **Boat/RV type per vehicle.** `lt_vehicle_type` ('boat'|'rv') synced per-vehicle. Asked during
      BOTH first-run ([CreateVehicleForm](dashboard/src/components/CreateVehicleForm.tsx)) and the
      Settings → "+ New" modal; changeable via Settings → Vehicles → "Change". (`addNewVehicle(name,type)`.)
- [x] **Owner field (above Full Admin).** Vehicle doc gets a single `owner` uid; creator becomes owner
      (`ensureOwnerAdmin` backfills). Pure `getOwner`/`isOwner` ([utils/sharing.ts](dashboard/src/utils/sharing.ts), tested).
      Owner shown with 👑 in Settings → Friends → People With Access.
- [x] **Transfer ownership.** Owner-only "Make owner" button per member (Friends tab) → `transferOwnership`
      (new owner becomes Full Admin; works under existing member-update rules).
- [x] **Transfer-or-delete on account deletion.** `classifyForDeletion` (tested) splits solo-owned (delete)
      / owned-shared (CHOOSE: transfer to a member or delete) / shared-not-owned (leave). The
      [DeleteAccountButton](dashboard/src/components/DeleteAccountButton.tsx) prompts per owned-shared vehicle.
- [x] **In-app vehicle delete no longer orphans the cloud doc.** "Delete this Vehicle" now HARD-deletes a
      sole-owned vehicle's cloud doc (was only removing self from `allowedUsers` → orphan lingering in the
      admin portal). Shared vehicles still "leave". Needs the delete rule deployed (below).

## ✅ Firestore rules DEPLOYED 2026-06-29 (was the #1 blocker)

The committed `firestore.rules` is now LIVE — release `cloud.firestore` → ruleset
`8d3070c2-01d6-4e69-808f-614c70d6153c`. Deployed via the Firebase Rules REST API using the Admin SDK
service-account key (`~/Downloads/boat-rv-guardian-9f8a4-firebase-adminsdk-*.json`): the SA has
`firebaserules.rulesets.create` + `releases.update`, but **not** `serviceusage.services.get` (so
`firebase-tools deploy` fails its API-enabled precheck — use the REST path, or grant the SA Service
Usage Consumer, or run `firebase deploy` under owner/user auth). The live rules now allow: read a
non-existent vehicle doc (`resource==null`, the new-vehicle SYNC FIX), `vehicles` delete for operators
+ sole owners, `users` delete for operators, operator update of members/allowedUsers/owner.
⚠️ **Native-verify** that a delete (admin console + in-app vehicle delete + account deletion) now
actually succeeds end to end.

## Follow-ups (small)

- [x] **SyncModal conflict modal removed → silent cloud-wins — DONE 2026-06-29.** The modal WAS still
      reachable (signed in + cloud config exists + local non-default + diverges), and its "Log out and use
      local" option was a lie post-2026-06-29 (`applyUserScope` wipes local on sign-out). Replaced the
      divergence branch in [components/SyncModal.tsx](dashboard/src/components/SyncModal.tsx) with a silent
      cloud-wins pull (matches the no-hybrid / cloud-source-of-truth model + the existing live multi-device
      sync), and deleted the modal JSX + `handleUseCloud`/`handleLogoutUseLocal`/`handleCancel` + `showModal`
      state. Extracted the (previously duplicated) comparison into pure, tested
      `cloudConfigDiffers` ([utils/configSync.ts](dashboard/src/utils/configSync.ts), 4 tests). The cloud-write
      error banner is unchanged. ⚠️ Native-verify a real divergence (edit a setting offline on one device →
      sign in → cloud silently wins, no prompt).

- [x] **🔴 Cross-account local-vehicle bleed — FIXED (2026-06-28).** Found via native testing: a fresh
      user signing in on the same device saw the previous user's boats, because local storage was a
      single global blob never cleared on logout/account-switch — exposing cached secrets (`lt_cloud_key`,
      `sh_local_password`, `sh_webhook_key`) across accounts. **Decision (owner): cloud (login) is the
      source of truth; local storage is a per-user offline cache.** New pure/tested
      [utils/userScope.ts](dashboard/src/utils/userScope.ts) (`applyUserScope`/`clearUserScopedData`):
      stamps localStorage with the owning uid and wipes all user-scoped `lt_*`/`sh_*` keys when the
      signed-in identity changes (login-as-other / sign-out), keeping device-local prefs (LOCAL_ONLY_KEYS).
      **Same-user restore (offline relaunch) is a no-op so the offline cache survives.** Wired into
      `App.tsx` `onAuthStateChanged` (wipe ⇒ hard reload). Onboarding now **requires sign-in** — the
      "Create a Local Vehicle (no account)" path was removed (signed-out = no vehicles). 6 tests.
      **Remaining follow-up:** make SyncModal reconciliation prune local vehicles no longer in the user's
      cloud list (e.g. one they left elsewhere) — additive merge still keeps stale-but-own entries; lower
      priority now that cross-account bleed is closed. Native-verify the login/logout/switch cycle.
- [x] **Notification-toggle rehydrate drift — FIXED (2026-06-28).** The Settings `settings_updated`
      rehydrate was a hand-maintained list of `setX(s.x)` lines that had drifted from `writeSettings`:
      it omitted `notifyFlood`/`notifyHouseBatt`/`notifyEngineBatt`/`notifyShorePower`, so a background
      `settings_updated` (e.g. cloud sync) left those four toggles stale. Replaced the manual list with
      `applyPersistedSettings(s, setters)` in [settingsStorage.ts](dashboard/src/utils/settingsStorage.ts)
      — a mapped-type `SettingsSetters` makes a persisted-but-not-rehydrated field a compile error, so
      this whole class of drift can't recur. Tested (completeness + the four-toggle regression).
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
