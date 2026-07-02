# Open Tasks

Working backlog for Boat & RV Guardian — **open action items only**. Completed work and its history
live in git and in the CLAUDE.md session handoffs; this file is intentionally pruned to what's still
to do. Last pruned 2026-07-02.

Legend: `[ ]` not started · `[~]` in progress / partially done.

---

## 🛡️ Security & correctness review (2026-07-02) — multi-repo audit

Findings from a full read-only review of all four repos, then remediated in focused PRs. **Merged**
items landed to `main` (non-prod: dashboard app, cloud-server, admin-site docs, main-repo docs).
**HELD** items are opened as PRs but need the owner's explicit OK because merging deploys to prod
(worker `**`, Pages sites) or the change deploys Firestore rules. **Deferred** items are documented
below with why.

### ✅ Merged
- [x] **SEC-2 — Max-flow-rate auto-shutoff was dead code** + **SEC-8 — stale `targetVolume` in the volume
      cutoff.** Fixed via a tested pure `utils/valveSafety.ts`. [#67](https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/pull/67).
      ⚠️ Still wants a hardware smoke test on a live gateway.
- [x] **SEC-6 — Firebase ID token POSTed to a member-settable URL.** `requestTrial` pinned to
      `DEFAULT_WORKER_URL`. [#69](https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/pull/69).
- [x] **SEC-14 — FCM token/payloads logged** + **SEC-15 — cleartext nav range.** [#72](https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/pull/72).
- [x] **SEC-3 (auth) — cloud-server fail-open webhook auth** + **SEC-10 — timing-unsafe compares.**
      Fail-closed `keyAuthorized` + `safeEqual`. [cloud-server #4](https://github.com/Boat-RV-Guardian/brvg-cloud-server/pull/4).
- [x] **SEC-3 (durability) — non-atomic file write / corrupt-db wipe** + **SEC-11 — unbounded device keys**
      + **SEC-12 — Docker root / `npm install`.** [cloud-server #5](https://github.com/Boat-RV-Guardian/brvg-cloud-server/pull/5).
- [x] **SEC-9 — admin console docs understated blast radius.** [admin-site #5](https://github.com/Boat-RV-Guardian/brvg-admin-site/pull/5).
- [x] **DOC-1..4** (README/ARCHITECTURE/PUSH_NOTIFICATIONS/.agents/DOMAIN_MIGRATION). [#73](https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/pull/73).
- [x] **DOC-5 (cloud-server README)**. [cloud-server #6](https://github.com/Boat-RV-Guardian/brvg-cloud-server/pull/6). (admin-site README folded into #5.)

### ✅ Merged + DEPLOYED to prod (2026-07-02)
- [x] **SEC-1 + SEC-13 — Firestore role enforcement + `trialsUsed` protection.** Role-aware vehicle-update
      rule (a plain member can't escalate role / seize owner / forge tier / grant access) + `trialsUsed`
      made worker-only. Verified against the Firestore emulator (JDK 21) — the `firestore-tests/` suite is
      17/17 green (the run surfaced + fixed a vacuous fixture in the trialEndsAt test).
      [#70](https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/pull/70). **Rules DEPLOYED** via the
      Firebase Rules REST API → live release `cloud.firestore` = ruleset `014945d5-c363-4a2c-b7ab-a2cb313d745e`.
- [x] **SEC-5 — worker `vid` path-injection.** `sanitizeVid` at all four ingress points + tests.
      [#71](https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/pull/71). Worker auto-deploy succeeded.
- [x] **SEC-16 + DOC-5 (website) — stale pricing/platform copy + stock README.**
      [website #8](https://github.com/Boat-RV-Guardian/website-boatrvguardian/pull/8). Pages auto-deploy succeeded.

### 🧊 Deferred (documented — not a quick fix)
- [ ] **SEC-4 — unauthenticated hosted webhook `/api/shelly?vid=`.** Guessable vid → forced valve close,
      FCM/SMS fan-out (cost attack, only capped by the Twilio trial), arbitrary `sensorState` writes.
      Can't make auth mandatory without re-provisioning every deployed Shelly device (breaks the live
      flood path). Needs a migration plan: optional per-vid HMAC/secret first, then flip to required.
      **Owner decision.** (SEC-5, the path-injection subset, is fixed in #71.)
- [ ] **SEC-7 — Tauri CSP disabled** ([tauri.conf.json](dashboard/src-tauri/tauri.conf.json) `"csp": null`).
      Adding a CSP risks breaking Firebase/asset loads, so it needs a native (`npm run tauri dev`)
      verification pass rather than a blind change. **Needs native verify.**

---

## 🔧 Hardware-gated (needs the physical devices / boat / home LAN)

These touch live Shelly / LinkTap hardware and the safety-critical poll/command path — do them when
the devices are reachable and the app can be smoke-tested against them, not unattended.

- [ ] **Task 1 — Verify Shelly Plus Uni remote telemetry end-to-end.** On the device's LAN, open the
      app once so it re-registers webhooks on a successful local poll, then:
  - [ ] `curl http://<uni-ip>/rpc/Webhook.List` — confirm `voltmeter.measurement` / `voltmeter.change`
        hooks carry `&v=${ev.xvoltage}&vraw=${ev.voltage}` and the right `cid` (voltmeter = 100, flood = 0).
  - [ ] Confirm the worker writes `vehicles/{vid}/sensorState/{shellyDeviceId}` with `v`/`vraw`, ~every 60s.
  - [ ] Confirm off-LAN the battery widget shows voltage. If wrong, check `webhookValueParams` / `cidFor`
        in [shellyRpc.ts](dashboard/src/utils/shellyRpc.ts) (placeholder `${ev.X}` syntax or cid is the
        likely culprit).
- [ ] **Task 11 cutover — re-register Shelly webhooks against `api.boatrvguardian.com`.** The code-side
      `DEFAULT_WORKER_URL` flip shipped (PR #62); devices still cache the old `*.workers.dev` URL until a
      successful poll re-registers them. Flood sensor + Uni both pending re-registration (needs on-LAN).
- [ ] **Task 3 — LinkTapWidget increment 5+** (split the last risky logic out of the 1559-line widget):
      polling loop → hook; command senders (start/stop) → hook; Flooding Sentry + auto-restart + washdown
      automation → hook. Touches the `commandersRef`/`stateRef`/`expectedWateringStateRef` state machine —
      verify against a live gateway, not by tsc/tests alone.
- [ ] **Task 2 follow-up — monitor-role command-gating RTL test.** The gating lives in `LinkTapWidget`,
      not Settings; cover it when that widget's logic is pulled into hooks (i.e. alongside Task 3 inc 5+).
- [ ] **Task 4 — client wiring for `/api/control`.** Route LinkTapWidget's OFF-LAN control through the
      already-deployed `POST /api/control` (sending the user's Firebase ID token) instead of calling
      LinkTap directly. Server side is live + inert until this lands.
- [ ] **Task 6 — off-LAN control gate.** Make LinkTapWidget honor `canRemoteControl` off-LAN (needs the
      local-vs-remote seam; pairs with Task 4).
- [ ] **Shelly password-set during provisioning — AP & BLE paths.** Manual-IP path is done; wire the
      Wi-Fi-AP path (ordering hazard: securing the device would 401 the subsequent unauthenticated
      `Wifi.SetConfig`) and the BLE path (`bleProvision`) to set `sh_local_password` on pairing. See
      [ProvisionShellyModal.tsx](dashboard/src/components/ProvisionShellyModal.tsx).
- [ ] **Verify `shellyChangePassword` on hardware.** Settings "Edit→Save" pushes the new password to every
      Shelly (`Shelly.SetAuth`); the digest path in [shellyRpc.ts](dashboard/src/utils/shellyRpc.ts) is
      untested. A wrong/failed SetAuth can lock a device out (factory reset to recover); sleeping battery
      sensors fail until they next wake (UI reports per-device results).

---

## 🖥️ Native-app verification queue (merged + gate-green, not yet runtime-verified)

Run in the native app (`cd dashboard && npm run tauri dev`) with a throwaway account. These are behavior
/ Firebase-coupled changes the CI gates can't fully catch.

- [ ] **Trial opt-in flow.** Signed-in + Free vehicle → "Start free trial" grants Basic + ~30 days; an
      already-trialed vehicle is declined (anti-abuse rule).
- [ ] **Delete-account.** Esp. the Firebase `requires-recent-login` re-auth path (executor surfaces it +
      signs out; confirm the UX). Confirm no orphaned data if a Firestore delete fails (#32).
- [ ] **Cross-account isolation (#33).** A new-user login shows no prior account's boats.
- [ ] **Admin-delete stickiness (#34).** Admin-delete a vehicle, then re-login → it stays gone (no resurrection).
- [ ] **New-vehicle sync.** A freshly-created boat appears in the admin Vehicles tab.
- [ ] **Local → cloud transitions.** (a) Rebuild: sign in from local mode → wipe + reload, vehicles rebuilt
      clean. (b) Migrate: "Migrate my vehicles to the cloud" uploads local vehicles to the new cloud account.
- [ ] **SyncModal silent cloud-wins.** Edit a setting offline on one device → sign in → cloud silently wins,
      no prompt.
- [ ] **Display-name edit.** Confirms the actual Auth `updateProfile` write (+ best-effort `users/{uid}` mirror).
- [ ] **New nav shell.** Full click-through of Overview / Systems / Alerts / Settings in the native runtime
      (verified in-browser 2026-06-30; native pending).

---

## 💳 Owner / external-gated (need Stripe, DNS, an email provider, or an owner-confirmed prod merge)

- [ ] **Stripe integration (deferred per owner).** The entitlement layer is provider-agnostic and
      `setActiveVehicleTier` is the drop-in seam (Stripe webhook → `setActiveVehicleTier`). Scope: real
      upgrade/downgrade/cancel, monthly⇄yearly, payment method, invoices/receipts, billing history (Stripe
      Customer Portal).
- [ ] **Receipts / billing emails.** Needs a transactional email provider — there is currently **no email
      service** in the stack (see the sharing model). Blocks billing emails; Stripe can send receipts.
- [ ] **SMS end-to-end delivery test-fire.** Twilio is live (trial acct) but delivery hasn't been fired
      end to end — needs a Twilio-**verified** destination cell.
- [ ] **Task 11 — `app.` (web app) + `admin.` Cloudflare Pages custom domains.** Attach in the Cloudflare
      dashboard (Pages custom domains; `wrangler` has no domain command). Lower priority; both already work
      at their current URLs.
- [ ] **Worker FCM/SMS send-success status.** Worker writes a `lastSend` field to `sensorState/{device}`
      (implemented in [#42](https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/pull/42)) — if that PR is
      still open, it needs an explicit owner OK to merge (`worker/**` auto-deploys to prod). Low priority.

---

## 🏗️ Self-host / infra (Task 7 line)

- [ ] **Unify + retire the main repo's live `worker/` onto the brvg-cloud-server core.** The greenfield
      self-host server already has a Firestore-capable storage seam + a Cloudflare Worker adapter; the
      owner-driven cutover ports the live worker onto it (kills the duplicated logic). Requires a hardware
      smoke of the real LinkTap/FCM calls since `worker/**` is the live flood-shutoff path.
- [ ] **Task 9 — add the Docker image build to CI** once the cloud-server unify lands.

---

## 🧊 Deferred by choice (parked with a reason — not blocked, just low value now)

- [~] **Task 3 — `useSettingsState` hook extraction** (Settings.tsx). The ~56 synced `useState` + the two
      coupled effects are scattered/interleaved across the 800-line file; attempted 2026-06-30 and reverted
      as high-risk for the just-stabilized sync layer and low value (pure internal cleanup). Do only as a
      dedicated, native-verified pass.
- [~] **Task 16 — relocate notification toggles + SMS prefs into Alerts** and remove the Settings→Account
      sign-in/sync duplication. Blocked on the `useSettingsState` extraction above; the Alerts page already
      links to notification prefs, so the user-facing need is met.
- [ ] **Task 14 — Account portal "sharing overview"** (read-only mirror of who has access per vehicle).
      Redundant with Settings → Friends and would need a live Firestore listener that breaks Account's
      deliberately Firebase-free/test-light design.
- [ ] **Task 14 — edit password / SSO** in the Account portal (display-name editing is done).

---

## 📌 Reference (not action items — kept because the open work above needs it)

**Version bumps touch 7 files** (keep in sync on every release):
`dashboard/package.json`, `dashboard/src-tauri/{tauri.conf.json,Cargo.toml,Cargo.lock}`,
`dashboard/src/pages/Settings.tsx` + `dashboard/src/components/LinkTapWidget.tsx` (`APP_VERSION`),
`dashboard/android/app/build.gradle` (`versionCode`+`versionName`). Current version: **1.0.48**.
Release = bump → commit → `git tag vX.Y.Z` → push main + tag (triggers `release.yml`).

**Build gates before release:** `npx tsc -b` + `npm run build` (dashboard),
`npx wrangler deploy --dry-run` (worker — raw `tsc` mis-flags it).

**Hardware facts (for the hardware-gated tasks):**
- **LinkTap gateway:** IP `172.31.0.245`, Gateway ID `1485A036004B1200`, valve/TapLinker ID
  `3CC1C335004B1200`. Local API `POST http://172.31.0.245/api.shtml` `{cmd, gw_id, dev_id}` — cmd 3=status,
  6=open `{duration,volume_limit,vol}`, 7=close. HTML-wrapped JSON; ~15s RF actuation lag.
- **Shelly flood sensor:** "shellyfloodg4" (Gen4), MAC `d8:85:ac:ea:39:14`. Battery/deep-sleep — never
  polled; only wakes to POST its webhook (trigger = wet the probes).
- **Shelly Plus Uni voltmeter:** 0-30V ADC peripheral, not enabled by default. Enable =
  `SensorAddon.AddPeripheral {type:'voltmeter'}` (creates `voltmeter:100`) THEN `Shelly.Reboot`.
  Calibration on-device via `Voltmeter.SetConfig {xvoltage:{expr:"x + <offset>"}}`. (Currently being
  relocated to the boat for lower-friction testing — Task 1.)
- **Vehicle id (Firestore):** `v_uusajkm88`. **Worker:** `boat-rv-guardian-webhooks`
  (`api.boatrvguardian.com` + `*.workers.dev`). Boat LAN is `172.31.0.0/16`.
