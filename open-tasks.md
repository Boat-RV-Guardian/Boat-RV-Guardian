# Open Tasks

Working backlog for Boat & RV Guardian — **open action items only**. Completed work and its history
live in git and in the CLAUDE.md session handoffs; this file is intentionally pruned to what's still
to do. Last pruned 2026-07-08.

Legend: `[ ]` not started · `[~]` in progress / partially done.

**Feature requests** (new-capability / future ideas, as opposed to active build/verify/bug work) are
tracked as GitHub issues labeled `enhancement`, not here:
https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/issues?q=is%3Aissue+label%3Aenhancement

---

## ✅ Shipped 2026-07-07 (big session — released v1.0.50 → v1.0.63)

All merged to `main`, all gates green, installed + tested on the owner's **Android phone** and the
**native macOS app** (Tauri). Notable landings:

- **Demo showcase** `demo.boatrvguardian.com` (mock mode): fake fleet + deterministic telemetry through
  the real widgets, scripted flood→auto-shutoff, `__DEMO__` build flag (tree-shaken from prod/native),
  `deploy-demo.yml` gated on `DEMO_DEPLOY_ENABLED`. **Owner-gated:** create the Pages project + attach
  `demo.boatrvguardian.com` + set the repo variable (see the Demo-site section below).
- **LinkTap cloud sign-in rework:** username+password → API key (LinkTap `getApiKey`), key HIDDEN from
  the user ("Sign in / Sign out of LinkTap Cloud"), redundant cloud "Connect" button removed (sign-in =
  connected), password unmask, guided first-time add that also configures gateway/valve IDs up front.
  **Bug fixed both repos:** LinkTap's getApiKey docs are WRONG — real success is `{"key":"…"}`, error is
  a bare `{"message":"…"}` (see [[boatrvguardian-linktap-getapikey-shape]]).
- **Flood re-registration VERIFIED** (Task 11 done): live `wrangler tail` caught flood.alarm/alarm_off
  hitting the new worker with `&k=` and the worker relaying the shutoff.
- **Shelly LAN-IP tracking:** webhooks carry `&ip=${status.wifi.sta_ip}`; app self-heals `localIp`.
- **AP + BLE provisioning now set the vehicle password** (flood sensor was `auth_en:false`).
- **Per-device "🩺 Scan for issues" + one-tap fixes** (voltmeter, password, webhook re-register, LAN
  reachability for LinkTap).
- **Device panel fixes:** toggles that "didn't work" (Device Enabled / Auto-Guard) — root cause was
  reading `e.target.checked` inside an async `import().then()` (controlled input reset first); now
  synchronous. Inline ✏️ rename. Removed the dead "Max Continuous Open" control.
- **Valve page:** correct connection badge (local only counts with a gateway IP), `—`/`LINK OK` instead
  of a false 0%, "Daily" label, **auto-limit externally-started opens** (physical-button open → max-volume
  safety cap), **Auto-Restart (Loop) gated to local-only / Free plan** (app-driven loop).
- **Nav:** Systems merged into Overview (cards drill in, ← Overview back). **Android edge-to-edge**
  bottom-tab-bar clipping fixed (safe-area vars + border-box #root). **macOS Local Network** declared
  (`src-tauri/Info.plist`) so LAN gateway discovery works — the LinkTap gateway moved to `172.31.0.244`.
- **v1.0.50 release** cut so the LinkTap event-driven rewrite + worker cutover finally shipped in a
  signed build (main had drifted 68 commits past the last tag).

---

## 🔐 Account / auth

- [x] **Email address verification on sign-up — DONE (2026-07-03).** Email/password sign-ups now send
      `sendEmailVerification`; a non-blocking app banner (`EmailVerifyBanner`) nudges unverified users
      with a Resend. Google sign-ins are exempt (already `emailVerified`); `brvg-tests.com` accounts are
      exempt (no email/banner) so agent testing keeps working. Pure helpers in
      [utils/emailVerification.ts](dashboard/src/utils/emailVerification.ts). **Follow-up:** hard-gate
      specific sensitive actions on `emailVerified` (deferred until we pick which — e.g. remote control
      once it's client-wired). The standalone account portal embeds the same exclusion.
- [x] **Task 14 — edit password / SSO — DONE (2026-07-03).** In-app Account view now has change-password
      (reauth + `updatePassword`, password-provider accounts only) + a Verified/Unverified email badge
      (pure [utils/changePassword.ts](dashboard/src/utils/changePassword.ts)). Also live in the account
      portal. (SSO/Google users have no password to change.)

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

### 🧊 Deferred / partially done
- [x] **SEC-4 — hosted webhook `/api/shelly?vid=` authentication — DONE (2026-07-08).** Per-vehicle webhook
      secret (`&k=`), verified constant-time. **Hosted (`api.boatrvguardian.com`) is permanently STRICT** —
      the multi-tenant worker rejects any request that isn't `ok` (no instance key, no phase flag; shipped
      with the 2026-07-04 cutover, cloud-server #20). All active devices re-registered emitting `&k=` (flood +
      valve verified live 2026-07-07; owner confirmed the rest 2026-07-08). **Self-host advanced to Phase 2**
      — `WEBHOOK_AUTH_REQUIRED = true` (brvg-cloud-server #24): an `unauthenticated` request (secret set, wrong/
      missing `k`) is now rejected; a `legacy` vehicle with no secret is still accepted. Shipped: classifier
      (cloud-server #8), app emits `&k=` + syncs `sh_webhook_secret` (#82), FirestoreStorage reads it
      (cloud-server #11), self-host admin can set it (cloud-server #12). Design:
      [docs/SEC4_WEBHOOK_AUTH.md](docs/SEC4_WEBHOOK_AUTH.md). (SEC-5 path-injection already fixed.)
- [x] **SEC-7 — Tauri CSP** ([tauri.conf.json](dashboard/src-tauri/tauri.conf.json)) — **DONE, merged
      [#76](https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/pull/76) (2026-07-02).** Replaced
      `"csp": null` with a real allowlist. Native debug-bundle verification found + fixed two origins the
      draft blocked (Google Fonts `fonts.googleapis.com`/`fonts.gstatic.com`; update-check `api.github.com`).
      Verified with a throwaway account: fonts, Firebase sign-up + Firestore sync, Google OAuth consent,
      update check, and a **live LinkTap LAN poll** (real boat gateway, valve status streaming every 5s) —
      zero CSP violations. Device LAN I/O is unaffected (Shelly via tauri-plugin-http, LinkTap via the
      `raw_linktap_post` native command — neither uses WebView fetch). FCM push delivery not exercised
      (endpoints are in `connect-src`).

---

## 🧩 App features (buildable anytime; verify with a device provisioning pass)

- [ ] **Save the vehicle's Wi-Fi credentials to the vehicle (owner request, 2026-07-22).** Option to
      store the boat/RV network's SSID + password as per-vehicle config so device provisioning (BLE and
      Wi-Fi-AP `Wifi.SetConfig`) prefills them instead of retyping on every sensor add — retyping (and
      an autocapitalized password) has been a real provisioning failure mode. Design notes:
      opt-in save (e.g. a "remember for this vehicle" checkbox on the provisioning SSID/password step +
      an editable field in Settings → Vehicles); store in the synced per-vehicle config (`sh_*`/`lt_*`
      namespace, so `applyUserScope` wipes it on identity change like the other per-vehicle secrets);
      masked display with reveal, like the LinkTap password field. ⚠️ Synced config is readable by ALL
      vehicle members (monitor included) — either accept that (documented) or gate the reveal/prefill
      to admin/control roles. Verify with a real provisioning pass on a device.

- [ ] **Dashboard UI Improvements:**
  - [ ] moveable tiles
  - [ ] ability to hide tiles
  - [ ] maybe resize?
  - [ ] create historical data widget options

- [ ] **Fix Account Page / Subscriptions (https://account.boatrvguardian.com):**
  - [ ] Update the subscriptions page to be an e-commerce-like plan screen.
  - [ ] Tie subscriptions to specific vehicles on the account (this will be the primary sign-up flow for all subscriptions).

---

## 🔧 Hardware-gated (needs the physical devices / boat / home LAN)

These touch live Shelly / LinkTap hardware and the safety-critical poll/command path — do them when
the devices are reachable and the app can be smoke-tested against them, not unattended.

- [ ] **Shelly Plus Uni — DEVICE DESTROYED 2026-07-22 (reverse-polarity hookup); replace + add
      protection diode to the design.** The Attic-test Uni (`shellyplusuni-f8b3b7fcfb74`) burned up
      when its DC supply was connected reversed. Before wiring a replacement:
      **hardware BOM change — add reverse-polarity protection** (a series Schottky diode, e.g.
      1N5819/SS34 on the supply lead — ~0.3 V drop at these currents — or a P-FET high-side
      protector for zero drop) to the battery-monitor harness design + install docs. The old item's
      remaining SOFTWARE verify (🩺 Scan fixes: enable-voltmeter → register cloud alerts → set
      password; manual RPC fallback in the 2026-07-08 handoff) transfers to the replacement Uni.
      (Historical repair steps: see the CLAUDE.md 2026-07-08 handoff. v1.0.66 shipped 2026-07-22
      without the Uni verify — the rest of the smoke test passed.)

- [~] **HTG3 (Environmental) — re-add with the #165 build and verify.** The first add attempt failed
      because the app had no environmental role — now shipped (#165: role detection, Climate section,
      Environment card, temp/RH/battery widget). NOTE the device's webhooks ARE already registered
      (the partial add got that far): `shellyhtg3-d885ac14c8ec` was pushing `humidity.change` to the
      worker cache as of 2026-07-22 18:5x. With the new build: re-add (auto-detects "Environmental
      Sensor") → it should appear under Overview → Environment with live temp/RH. Flood sensor was
      re-added + re-verified live the same day (its `flood.alarm` exercised the worker auto-shutoff).

- [x] **Task 1 — Shelly Plus Uni remote telemetry — ROOT-CAUSED + FIXED 2026-07-03.** It never worked
      because provisioning enabled the voltmeter peripheral (which reboots the device) AFTER registering
      webhooks + securing — so `voltmeter.*` events didn't exist when webhooks registered (the 10-hook
      slot filled with `input.*`) and the password step ran against a rebooting device (left `auth_en:false`).
      Confirmed on-device (Uni `192.168.50.181`): 10 input.* hooks, zero voltmeter.*. Fixes shipped:
      provisioning reorder — voltmeter→reconnect-wait→webhooks→secure (#95); **cloud-webhook self-heal on
      local poll** (#94, `refreshCloudShellyWebhooks`); the live Uni was fixed directly over the LAN (added
      voltmeter.measurement/.change with `&v=${ev.xvoltage}&vraw=${ev.voltage}`, cid 100) and the worker
      confirmed `persisted:true` — it now shows in the admin Operations tab (`v=12 vraw=11.66`).
  - [x] **Shore-power PM Mini G3** (`shellypmminig3-...`, `192.168.86.171`): same class of bug — its
        `pm1.voltage_change` hook carried no value (webhookValueParams only handled `voltmeter.*`) and the
        cloud→widget mapping only mapped to `voltmeter:100`, never `pm1:0`. Fixed (#96): `pm1.voltage_change
        → &v=${ev.voltage}`, `WEBHOOK_EVENT_RE` matches `voltage`, role-aware cloud mapping, duplicate-hook
        dedup. Live device fixed over LAN (one clean voltage hook). ⚠️ **Live-worker gap:** the orphaned
        worker classifies `pm1.voltage_change` as an alert (spurious FCM attempt, `pushFailed`); brvg-cloud-
        server already treats it as telemetry, so the **Task 7 cutover** resolves it.
  - [ ] **Still to verify off-LAN (native):** battery + shore-power widgets show voltage from `sensorState`
        after the #96 role-aware mapping (build the debug `.app`; needs the real account signed in).
- [x] **Task 11 cutover — re-register Shelly webhooks against `api.boatrvguardian.com` — DONE (all sensors).**
      The code-side `DEFAULT_WORKER_URL` flip shipped (PR #62); devices re-register on a successful poll (or
      wake). **Uni battery sensor: FIXED 2026-07-03** — telemetry live in the admin Operations tab
      (`v=12 vraw=11.66`). **PM Mini G3 (shore power, `192.168.86.171`): FIXED** — voltage now persists
      (`v=118`). Both were on the correct URL already; the real gaps were the voltmeter-enable-reboot ordering
      + missing value params (see Task 1, fixed in #94/#95/#96). **Flood sensor (`shellyfloodg4-d885acea3914`):
      FIXED + VERIFIED 2026-07-07** — re-registered after re-adding it on-LAN with v1.0.50 open while awake.
      Confirmed live via `wrangler tail brvg-cloud-worker`: `flood.alarm` **and** `flood.alarm_off` both hit
      `api.boatrvguardian.com/api/shelly?...&k=…` and the worker relayed the valve shutoff
      (`flood event flood.alarm on v_uusajkm88: shutoff {"ok":true,"valves":1}`) — the full flood → auto-shutoff
      safety chain works end-to-end on the new worker. (Off-LAN native widget display verify is still tracked
      under Task 1.)
- [x] **Task 3 — LinkTapWidget increment 5+ — DONE (2026-07-10, redone fresh; #120 not salvaged).**
      Widget 1585 → ~948 lines across 6 gate-green increments: pure decision rules →
      `utils/valveAutomation.ts` (normalRunCommand / commandLockMs / autoRestartDecision / washdownTick,
      14 tests); alarm+notifications → `hooks/useAlarmNotifications.ts`; command senders + optimistic
      lock + commandersRef → `hooks/useLinkTapCommands.ts` (7 tests); the polling loop + telemetry
      state + stateRef → `hooks/useLinkTapPolling.ts` (poll body moved verbatim); Flooding Sentry /
      safety guard / offline / battery / watering alerts → `hooks/useValveSentries.ts`. Widget render
      smoke test guards the hook composition. ✅ **Live-gateway smoke test PASSED (2026-07-22, onsite
      macOS app + `wrangler tail`):** LAN poll live at 5s (after fixing this Mac's EMPTY gateway IP —
      the "stale data" symptom; set to `172.31.0.244`); 3 opens via the worker's `/api/control` relay;
      2 hardware-timer closes (1-min runs); 1 **manual Stop mid-run** via `/api/control` (6:08:41 PM
      POST → valve closed, wateringOff 16s later); LinkTap events → worker → Firestore → app
      "server-observed" all live; a real `flood.alarm` (5:58 PM) triggered the worker auto-shutoff
      (`{"ok":true,"valves":1}`). Not exercised: the software volume cutoff under real flow (runs
      closed on timer first; covered by unit tests) — verify opportunistically during a real fill.
- [x] **Task 2 follow-up — monitor-role command-gating test — DONE (2026-07-10).** Covered directly in
      `useLinkTapCommands.test.tsx`: monitor users can't start or manually stop; automation `'limit'`
      stops stay ungated; plus cloud-first routing, LAN fallback, and always-present open limits.
- [x] **Task 4 — client wiring for `/api/control` — was already DONE (stale entry).** Shipped 2026-07-04
      in [#106](https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/pull/106) (see the LinkTap redesign
      section): open/close route through the worker's role-checked `/api/control` with the Firebase ID
      token, LAN gateway as fallback. Now lives in `hooks/useLinkTapCommands.ts`.
- [x] **Task 6 — off-LAN control gate — DONE (2026-07-10).** `useLinkTapCommands` now skips the cloud
      `/api/control` relay when the vehicle's plan lacks `canRemoteControl` (via `useEntitlements`) —
      commands go LAN-only (local control is always free), with an explanatory Event-Sentry log and a
      plan banner in the widget when signed-in off-LAN without a LAN gateway. **SAFETY `'limit'` stops
      (flood shutoff / volume cutoff) are exempt and always try every channel.** Covered by 3 hook tests.
      **Follow-up (server-side, AGENTS rule 5):** the worker's `/api/control` enforces ROLE but not TIER —
      add a `canRemoteControl` tier check in brvg-cloud-server so a Free-plan client can't bypass the
      client gate (needs an owner-OK'd worker deploy).
- [x] **Shelly password-set during provisioning — AP & BLE paths — DONE (#118, 2026-07-07).** Both paths
      now set `sh_local_password`: the Wi-Fi-AP path secures at `192.168.33.1` BEFORE `Wifi.SetConfig`
      (resolving the 401 ordering hazard by sending the remaining call through `shellyRpc`'s digest
      handshake), and the BLE path sets it over HTTP right after the device joins Wi-Fi. Best-effort.
      **Hardware verify (owner):** re-provision the flood sensor over BLE → `Shelly.GetDeviceInfo` should
      flip from the recorded `auth_en:false` baseline to `auth_en:true`.
- [ ] **Verify `shellyChangePassword` on hardware.** Settings "Edit→Save" pushes the new password to every
      Shelly (`Shelly.SetAuth`). The underlying **digest-auth path is now hardware-verified** (#166,
      2026-07-22 — Gen3 header-form challenge, live PM Mini G3), so only the SetAuth flow itself remains.
      A wrong/failed SetAuth can lock a device out (factory reset to recover); sleeping battery
      sensors fail until they next wake (UI reports per-device results).

---

## 🖥️ Native-app verification queue (merged + gate-green, not yet runtime-verified)

Run in the native app (`cd dashboard && npm run tauri dev`) with a throwaway account. These are behavior
/ Firebase-coupled changes the CI gates can't fully catch. (Pruned 2026-07-08 as sufficiently verified in
prior live sessions: cross-account isolation #33, admin-delete stickiness #34, new-vehicle sync.)

- [ ] **Trial opt-in flow.** Signed-in + Free vehicle → "Start free trial" grants Basic + ~30 days; an
      already-trialed vehicle is declined (anti-abuse rule).
- [ ] **Delete-account.** Esp. the Firebase `requires-recent-login` re-auth path (executor surfaces it +
      signs out; confirm the UX). Confirm no orphaned data if a Firestore delete fails (#32).
- [ ] **Local → cloud transitions.** (a) Rebuild: sign in from local mode → wipe + reload, vehicles rebuilt
      clean. (b) Migrate: "Migrate my vehicles to the cloud" uploads local vehicles to the new cloud account.
- [ ] **SyncModal silent cloud-wins.** Edit a setting offline on one device → sign in → cloud silently wins,
      no prompt.
- [ ] **Display-name edit.** Confirms the actual Auth `updateProfile` write (+ best-effort `users/{uid}` mirror).
- [ ] **New nav shell.** Full click-through of Overview / Systems / Alerts / Settings in the native runtime
      (verified in-browser 2026-06-30; native pending).

---

## 💳 Owner / external-gated (need Stripe, DNS, an email provider, or an owner-confirmed prod merge)

- [ ] **🔴 Deploy the hosted worker (owner OK needed — prod).** `brvg-cloud-worker` is running
      **2026-07-04 code** (checked `wrangler deployments list` 2026-07-22) — it's missing the LinkTap
      flow-rate unit fix (cloud-server #21: `vel` is mL/min, so cloud-path flow reads ~1000× off), the
      server-side getApiKey shape fix (#23), and the Task 6 tier gate (#25). Deploy = `cd
      brvg-cloud-server && npx wrangler deploy` (secrets already set on the worker).
- [~] **Shore power — a NEW PM Mini G3 ("Dryer Plug", `shellypmminig3-dcb4d9db00fc`, 172.31.0.116) was
      added ONSITE 2026-07-22**; it initially "didn't populate" — root cause was the Gen3 digest-auth
      bug (#166, fixed): the AP path secures the device first, then every authenticated call failed, so
      no webhooks registered and polls died. With the #166 build installed, the poll self-heal registers
      its hooks automatically on the first successful poll — **verify voltage shows + a `pm1.voltage_change`
      doc appears in sensorState**. The OLD home PM Mini (`…d9db9850`, 192.168.86.x, dark since ~7/07)
      is a separate unit — check power/Wi-Fi when at home or retire its config.
- [x] **Deploy the account portal → `account.boatrvguardian.com` — DONE (2026-07-08).** `brvg-account-site`
      (Astro + React islands; profile / telemetry / subscription) is LIVE. Created the `brvg-account-site`
      Cloudflare Pages project + deployed via `wrangler pages deploy` (sc4tech account
      `9b75e814c0fc254c910fd1afc3c88028`; canonical `brvg-account-site.pages.dev`). Owner attached the custom
      domain `account.boatrvguardian.com` (Pages custom domain — needs DNS write the CI token lacks) + added it
      to Firebase Auth → Authorized domains. Verified live: `https://account.boatrvguardian.com` → HTTP 200,
      correct title. No Pages secrets needed (client-only public Firebase web config).
- [ ] **Stripe integration (deferred per owner).** The entitlement layer is provider-agnostic and
      `setActiveVehicleTier` is the drop-in seam (Stripe webhook → `setActiveVehicleTier`). Scope: real
      upgrade/downgrade/cancel, monthly⇄yearly, payment method, invoices/receipts, billing history (Stripe
      Customer Portal).
- [ ] **Receipts / billing emails.** Needs a transactional email provider — there is currently **no email
      service** in the stack (see the sharing model). Blocks billing emails; Stripe can send receipts.
- [ ] **SMS end-to-end delivery test-fire.** Twilio is live (trial acct) but delivery hasn't been fired
      end to end — needs a Twilio-**verified** destination cell.
- [ ] **Worker FCM/SMS send-success status.** Worker writes a `lastSend` field to `sensorState/{device}`
      (implemented in [#42](https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/pull/42)) — if that PR is
      still open, it needs an explicit owner OK to merge (`worker/**` auto-deploys to prod). Low priority.

---

## 🏗️ Self-host / infra (Task 7 line)

- [x] **Unify + retire the main repo's live `worker/` onto the brvg-cloud-server core — CUTOVER DONE
      (2026-07-04).** `api.boatrvguardian.com` now routes to `brvg-cloud-worker` (`FirestoreStorage`,
      same Firestore, with FCM/LinkTap/connectors/authz/retention/device-limits + strict per-vehicle
      SEC-4 auth + the LinkTap `/api/linktap` pipeline). Deployed with Firebase + `LINKTAP_WEBHOOK_SECRET`
      secrets; `/api/health` + `/api/shelly` (401 without `&k=`) + `/api/linktap` verified live. The old
      `boat-rv-guardian-webhooks` worker is left in place for rollback (move the custom domain back).
      **Remaining:** owner re-adds devices on-LAN so they re-register with `&k=` (else they 401 — the
      flood + valve are the ones that matter); then delete the old worker after a few clean days. There
      is **no SEC-4 Phase-2 flip** on the hosted worker — it's strict from the start (cloud-server #20).
- [x] **Task 9 — Docker image build in CI.** DONE — brvg-cloud-server CI builds the Docker image and runs a
      `wrangler --dry-run` bundle-check of the Worker adapter.
- [x] **Create device limits in plans (free 3 / basic 6 / premium 20).** DONE — client entitlement +
      Add-a-device gating ([#79](https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/pull/79)); server-side
      `device_limit_reached` enforcement in the worker (brvg-cloud-server, matching numbers). ⚠️ UI wants a
      native verify.
- [x] **Self-hosted feature limitations & new connectors.** DONE — **SMS, WhatsApp, and Telegram are all
      hosted-cloud only** (owner decision, brvg-cloud-server #13): the hosted Worker adapter wires all three;
      the self-host Node server ships **no** message senders. WhatsApp + Telegram senders added + tested
      (brvg-cloud-server #9); app account-portal UI ([#80](https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/pull/80));
      FirestoreStorage reads the prefs (brvg-cloud-server #11). ⚠️ App UI wants a native verify; real delivery
      needs provider creds.
- [x] **Free push for the self-hosted version — DONE via ntfy** (owner picked ntfy). No Firebase project
      required: set a per-vehicle ntfy topic in `/admin`, users subscribe in the ntfy app; the server
      publishes alerts to it. Wired on self-host + hosted, FirestoreStorage carries the fields, tested +
      documented (brvg-cloud-server #14). Optional follow-up: an app-side UI to set an ntfy topic for
      **hosted** vehicles (hosted already has FCM, so low priority).

---

## 🚿 LinkTap architecture redesign (event-driven; 2026-07-03)

The current LinkTap integration is **client-poll-and-react**: every app instance polls the valve
(~5s local / ~31s cloud) and re-implements safety/automation itself. This is fragile and caused a
real, hard-to-debug incident — a **stale signed-in copy** (old web build with the since-removed
flow-rate shutoff, reachable via the shared LinkTap cloud creds AND the boat↔home SpeedFusion VPN)
kept slamming the valve closed ~40s after every open, from *both* our app and LinkTap's own Start
button. Ruled out our live app (opens 24h/300gal, sends no stop, logs nothing) and the cloud worker
(tailed it live: only `voltmeter.measurement` telemetry, zero flood webhooks, zero shutoff). Root
cause was device-/instance-side, not our worker. LinkTap's own API gives us a much better model.

- [x] **LinkTap events → webhook — SERVER SIDE DONE (2026-07-04, brvg-cloud-server #15–#20).** LinkTap
      `setWebHookUrl` → **`/api/linktap`** (secret-gated `?t=`), routed by `gatewayId` → vehicle,
      coalesced into the same `sensorState` cache + FCM/ntfy alert pipeline the Shelly webhooks use.
      Pure classifier (`linktapEvents`), ingest (`linktapCore`), command relay (`linktapCommands`:
      instantMode **without `vol`** — fixed the 400 — plus plans / pause / `dismissAlarm`), account
      API (`linktapAccount`: setWebHookUrl / deleteWebHookUrl / getApiKey), opt-in **auto-recover**
      (benign `noWater`/low-flow only; never high-flow/valve-broken/fall/freeze), and the permanent
      **hosted multi-tenant auth** (per-vehicle `&k=` required, no instance key). **DEPLOYED + LIVE** on
      `brvg-cloud-worker.jgearinger.workers.dev` with secrets set; MVP's LinkTap webhook is registered;
      `/api/shelly` verified 401 without `&k=`. ~129 tests.
      - **App side — DONE (2026-07-04):** off-LAN valve state now comes from the worker cache via
        Firestore `onSnapshot` ([#103](https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/pull/103)
        + display #105 + read-swap #107), and **open/close route through `/api/control`**
        ([#106](https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/pull/106)) — the app no longer
        calls LinkTap cloud directly, so the worker is the single reader + actuator. **Multi-instance
        race retired both ways.** On-LAN gateway path kept as the offline fallback.
      - **Worker cutover — DONE (2026-07-04):** `api.boatrvguardian.com` moved to `brvg-cloud-worker`
        (custom domain in `wrangler.toml`); verified live. Old worker left for rollback.
      - **Payloads confirmed live:** real capture showed flow arrives in `vel` (mL/min) — parser fixed
        to L/min (cloud-server #21); `wateringOn` battery is a `"100%"` string (handled); `msg`/`event`
        both used. **NATIVE-VERIFY (owner):** re-add the LinkTap valve + flood sensor (they re-register
        with `&k=`), then sign in and open/close the valve (cloud path) + off-LAN read + on-LAN local
        fallback. One minor on-LAN limit-supplement `getWateringStatus` fetch remains (edge case).

- [x] **Auto-fetch / rotate the LinkTap API key — DONE (app-wired 2026-07-07, #114/#124/#134/#136).**
      App `linkTapGetApiKey(username, password)` in [utils/linktapCloud.ts](dashboard/src/utils/linktapCloud.ts)
      parses the REAL response shape (`{"key":"…"}` success / bare `{"message":"…"}` error — the docs are
      wrong; same fix landed in brvg-cloud-server #23). Password used once, never persisted. Surfaced as
      "Sign in / Sign out of LinkTap Cloud" (key hidden from the user); sign-in enables cloud polling.

- [x] **Guardian-native LinkTap onboarding — "no second app" — DONE (2026-07-07, #114/#132).** Adding a
      LinkTap valve runs a guided flow: username+password → API key → `getAllDevices` list → pick + name the
      valve → and it also persists the gateway/TapLinker IDs, turns cloud control on, and (Tauri) scans the
      LAN for the gateway IP — everything the old Advanced-Options "Retrieve + Connect" did, in one pass. The
      hard boundaries (account creation / gateway Wi-Fi / valve↔gateway pairing — no API; full public
      API surface re-verified against LinkTap's live doc 2026-07-07) remain one-time in the LinkTap app.
      Cover them by **pre-provisioning hardware kits at fulfillment** (customer never installs the LinkTap
      app) and a one-time "install LinkTap, pair, come back" screen for BYO-hardware users.

- [ ] **Owner action — email support@link-tap.com for a provisioning/pairing API.** Their API page
      invites "further requirements." Ask whether they expose gateway onboarding + valve pairing to
      integrators; if yes, the last one-time LinkTap-app dependency disappears entirely. (True
      zero-LinkTap-account alternative remains **Shelly + motorized ball valve** — see the deferred note.)

---

## 🎬 Demo site — `demo.boatrvguardian.com` (mock mode) — LIVE 2026-07-08

Public, no-login showcase of the full app driven by fake sensors. **Built end-to-end** (#109/#110/#112):

- [x] **Demo/mock data layer** — fake fleet "Serenity (Demo)" (valve + shore power + house/engine battery
      + bilge flood + cabin temp) driven by pure, deterministic `fn(t)` generators emitting the SAME
      `sensorState` doc shapes the worker writes, fed through the real widgets (no UI fork). Seeded history,
      scripted flood → auto-shutoff → alert incident, "🎬 Demo" banner. Files: `utils/demoTelemetry.ts`,
      `utils/demoFleet.ts`, `utils/demoSeed.ts`, `hooks/useDemoScenario.ts`.
- [x] **Build-flag gated** — `__DEMO__` (vite `define`, `--mode demo`) constant-folds to false in every
      normal build, so the fake fleet + generators are **tree-shaken out of the production web app and the
      native apps** (grep-verified). `dev:demo` / `build:demo` npm scripts. "Try the live demo" link on the
      real login screen → `demo.boatrvguardian.com`.
- [x] **Deploy workflow** — `deploy-demo.yml` (mirrors deploy-dashboard, builds `--mode demo`, publishes to
      a `boat-rv-guardian-demo` Pages project), **gated on repo var `DEMO_DEPLOY_ENABLED`** so it cleanly
      skips until enabled.
- [x] **Pages project created + first deploy — DONE (2026-07-08).** `boat-rv-guardian-demo` Pages project
      created + deployed via `BRVG_TARGET=web npm run build:demo` → `wrangler pages deploy` (sc4tech account
      `9b75e814c0fc254c910fd1afc3c88028`). Live at `boat-rv-guardian-demo.pages.dev` (HTTP 200).
- [x] **Repo variable `DEMO_DEPLOY_ENABLED=true` set — DONE (2026-07-08, via `gh variable set`).** So every
      dashboard change now auto-deploys the demo via `deploy-demo.yml`.
- [x] **Custom domain `demo.boatrvguardian.com` attached — DONE (2026-07-08, owner).** Verified live:
      `https://demo.boatrvguardian.com` → HTTP 200. No Firebase authorized-domain step needed (mock mode,
      no auth). The full demo showcase is now public + auto-deploying on every dashboard change.

## 🧊 Deferred by choice (parked with a reason — not blocked, just low value now)

Dropped 2026-07-08 (owner prune; retrievable from git history if ever wanted): `useSettingsState`
extraction + the Task 16 notification-toggle relocation (attempted + reverted, high-risk / low value —
if Settings.tsx internals ever need a rework, do it then as a dedicated native-verified pass), the
Account-portal "sharing overview" (redundant with Settings → Friends), and the `app.`/`admin.` Pages
custom domains (both sites work fine at their current URLs).

- [ ] **Gateway-free / zero-third-party-cloud valve = Shelly + motorized ball valve.** LinkTap valves
      speak proprietary sub-GHz RF and **cannot exist without a LinkTap gateway** (hardware fact; no
      pairing API). For a truly gateway-free, no-LinkTap-account valve, use a **Shelly switch (Gen3/Plus)
      driving a 12V motorized ball valve** — rides the existing Shelly LAN-RPC + webhook + provisioning
      path with near-zero new server code (add a "valve" role for a Shelly switch: open/close UI +
      Flooding-Sentry hook). Trade-off vs LinkTap: no integrated flow meter (add a pulse flow sensor on
      a Shelly Uni input if wanted). Fits the low-cost-first site framing. Parked pending product call.

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
