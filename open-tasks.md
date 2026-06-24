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

## Notes

- **Version bumps touch 7 files** (per CLAUDE.md): `dashboard/package.json`,
  `dashboard/src-tauri/{tauri.conf.json,Cargo.toml,Cargo.lock}`,
  `dashboard/src/pages/Settings.tsx` + `dashboard/src/components/LinkTapWidget.tsx`
  (`APP_VERSION`), `dashboard/android/app/build.gradle`. Keep them in sync on every release.
- **Build gates before release:** `npx tsc -b` + `npm run build` (dashboard),
  `npx wrangler deploy --dry-run` (worker).
</content>
</invoke>
