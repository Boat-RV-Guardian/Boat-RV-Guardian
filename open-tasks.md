# Open Tasks

Working backlog for Boat & RV Guardian — **open action items only**. Completed work and its history
live in git and in the CLAUDE.md session handoffs; this file is intentionally pruned to what's still
to do. Last pruned 2026-07-02.

Legend: `[ ]` not started · `[~]` in progress / partially done.

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
