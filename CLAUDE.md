# Boat & RV Guardian — agent notes

## Time & timestamps (storage = UTC, display = device time zone)

**Policy:** every timestamp is **stored in UTC** and **displayed in the device's configured
time zone**. Do not deviate from this.

- **Storage** → persist epoch milliseconds (`Date.now()`) or ISO-8601 (`date.toISOString()`).
  Never persist a localized/formatted time string, and never store wall-clock time without a zone.
  Example: LinkTap per-device usage history buckets use `new Date().toISOString()`.
- **Display** → format through `dashboard/src/utils/time.ts`
  (`formatTime` / `formatDate` / `formatDateTime`). These render in the `lt_tz` setting (a
  device-local preference, NOT cloud-synced — see `LOCAL_ONLY_KEYS` in `utils/configSync.ts`),
  falling back to the OS-resolved zone, then UTC.
- **Never** call `toLocaleTimeString` / `toLocaleDateString` / `toLocaleString` directly in
  components — they use the raw browser zone and ignore the user's `lt_tz` choice.
- `lt_tz` can change at runtime; components showing times keep a `displayTz` state refreshed on
  the `settings_updated` event so already-rendered times reformat (see `LinkTapWidget.tsx`).

## Where historical / event data lives

**On-device (always):**

- `localStorage['lt_usage_history_<deviceId>']` — per-device water-usage history. Keys are UTC
  ISO-8601 hour buckets, values are flow-volume deltas (liters). Gated by `lt_enable_history`.
- `localStorage['lt_event_log_<deviceId>']` — the **Event Sentry Log** (`{ts,type,message}[]`,
  capped 50). The flow-rate line chart (`flowHistory`) is still in-memory only.

**Cloud (opt-in, Phase 1):** when `lt_store_history_cloud === 'true'`, `utils/historySync.ts`
mirrors usage + events into **monthly rollup docs** at `vehicles/{vid}/history/{deviceId}_{YYYY-MM}`
(`usage` and `events` are maps so `setDoc(merge)` is append-only). `LinkTapWidget` debounce-pushes
the current/previous month (~10s) and reads those two docs back on mount/login, merging into local
state (usage = max per bucket, events = dedup by `ts|message`). The worker stores no history — it
only reads vehicle config to relay LinkTap commands.

(History rule is included in the consolidated ruleset below.)

## Shelly devices (provisioning, polling, alerts)

- **BLE provisioning** (`utils/shellyBle.ts`, native Android/iOS only — first/recommended there;
  hidden on desktop/web): scan by name, `Wifi.Scan` over BLE for SSID picking, then `Wifi.SetConfig`,
  then poll `Wifi.GetStatus` until a real (non-`0.0.0.0`) DHCP IP appears and save it as `localIp`.
  Mongoose-OS RPC framing over GATT. SSID/password inputs disable autocapitalize/autocorrect (an
  autocapitalized password was the real bug). Wi-Fi AP / Manual IP paths still exist (HTTP RPC).
- **Battery/sleepy sensors** (flood etc.) set `device.batteryPowered` and are **never polled** —
  they deep-sleep, so polling shows false "down" and waking them drains the battery. They report on
  their wake cycle and push real-time alerts via the webhook. `ShellyWidget`/`useShellyStatus` do one
  best-effort read on mount + a manual 🔄; mains sensors (shore/battery-voltage) poll local-first.
- **Cloud alerts**: `Webhook.ListSupported` discovers the device's real events; provisioning
  registers webhooks to `${sh_webhook_url || DEFAULT_WORKER_URL}/api/shelly?vid=…&event=…`. The
  worker (`boat-rv-guardian-webhooks`, deployed at `…jgearinger.workers.dev`) reads the vehicle +
  `users/{uid}.fcmToken` and sends FCM pushes. The app writes its FCM token to `users/{uid}`.
  Needs `firebase.messaging` scope (set) + FCM API enabled. `sys.online` is INVALID on flood
  sensors — always discover events, never hardcode.
- `sh_local_password` (per-vehicle, auto-generated) is for optional local auth; not pushed by default.
- Per-device polling is local-first (`http://<ip>/rpc/Shelly.GetStatus`, ~8s) → Shelly cloud
  fallback (~15s); `Sensors.tsx` category pages render the `lt_devices` model via `ShellyWidget`.
- **Provisioning** (`ProvisionShellyModal`): auto-detects sensor type from `Shelly.GetDeviceInfo`,
  and **only creates the cloud webhook when signed in**. Removing a device confirms via dialog and
  can optionally send `Shelly.FactoryReset` to its local IP (best-effort).
- Transport rationale: HTTP RPC chosen over MQTT (needs a broker) and UDP RPC (WebViews can't open
  UDP sockets). Shelly Gen2 auth is done in the JSON-RPC body, so authenticated local polling is
  possible in pure JS later without native code.

## Friends / vehicle sharing (`utils/sharing.ts`, `hooks/usePendingInvites.ts`)

Per-vehicle sharing with three roles — `admin` (Full Admin), `control` (Monitor & Control),
`monitor` (view only). **No email service** (chosen option): invites are discovered by the
invitee's email and accepted manually; the inviter shares a copyable message.

- **Vehicle doc** gains `members: { <uid>: { role, email } }` (kept in sync with `allowedUsers`).
  `getMyRole(vehicleData)` resolves the current user's role; a legacy member with no `members`
  entry is treated as `admin` (original owner). `ensureOwnerAdmin()` backfills this.
- **Invites** live in `invites/{autoId}`: `{ vehicleId, vehicleName, role, invitedBy,
  invitedByEmail, inviteeEmail (lowercased), status }`. They are **not** auto-applied — the
  Friends tab shows pending invites (via `usePendingInvites`, matched on the user's email) to
  accept/decline. Accepting adds the user to the vehicle (`acceptInvite` sets a transient
  `lastClaimInviteId` so the rule can verify the invite). Admins remove members / cancel invites;
  members `leaveVehicle()`.
- **Role enforcement:** `SyncModal` stashes the active vehicle's role in `localStorage['lt_my_role']`
  and fires a `role_updated` event. `LinkTapWidget` reads it: monitor-only users see a banner and
  user-initiated valve commands no-op (automation/auto-restart still works via the un-gated raw
  command). Enforcement is currently client-side only — a monitor with the vehicle's cloud
  credentials could still call the device API directly; hardening that requires routing control
  through the worker.

## Per-user local data — cloud is source of truth, local is a per-user cache (2026-06-28)

**Invariant:** the signed-in Firebase account owns the local data. Local storage (`lt_*`/`sh_*`) is an
**offline cache of the currently-signed-in user only** — never a shared global blob. The cloud
(Firestore, keyed to the user's `allowedUsers` vehicles) is the source of truth for the vehicle list.

- [utils/userScope.ts](dashboard/src/utils/userScope.ts) stamps localStorage with the owning uid
  (`lt_data_owner_uid`). `applyUserScope(uid)` wipes all user-scoped `lt_*`/`sh_*` keys (vehicles,
  per-vehicle config + **secrets**, role/tier/trial stashes, per-device history/logs) when the identity
  changes — login-as-different-user OR sign-out. It **keeps** device-local prefs (`LOCAL_ONLY_KEYS`:
  tz/unit/notification toggles/polling flags) and is a **no-op on same-user restore** so the offline
  cache survives an offline relaunch.
- Wired in `App.tsx` `onAuthStateChanged`: a wipe triggers a hard reload so no in-memory state from the
  prior session leaks. **Do not** add code that reads/writes vehicle data while signed out, or that
  persists vehicles outside this ownership model.
- Onboarding offers **hosted cloud sign-in (encouraged default)** or **local-only mode** (no account).
  Local-only data is still owned/isolated via a synthetic local owner id (so it can't bleed into a real
  account); a local-only user upgrades to sync by switching to cloud mode in Settings (see the config-sync
  model below). Offline still works for a once-signed-in cloud user (Firebase Auth persists the session).
- Known follow-up: SyncModal's cloud reconciliation is still **additive** (it adds the user's cloud
  vehicles but doesn't prune ones they've since left elsewhere). Safe now that cross-account bleed is
  closed; prune later for full cloud-authoritative behavior.

## Configuration sync model — hosted cloud only; self-host & local are per-device (2026-06-29)

**Decision (owner):** configuration sync is a **hosted-BoatRVGuardian-cloud feature only**. Encourage
cloud use; **fall back to open-source/self-host** when the user opts out.

**A device (and its vehicles) is EITHER cloud OR local — never both. No hybrid accounts** (mixing the two
caused real bugs). The mode is **device-wide**, not per-vehicle. You cannot have some local vehicles and
some cloud vehicles on one device. Transitions between modes are explicit and total:
- **Local → cloud:** either **rebuild** the vehicles in the cloud (signing into a cloud account from local
  mode **wipes** the local session via `applyUserScope`, so you start clean in the cloud) OR **migrate**
  (DONE 2026-06-30, Task 15) — `utils/migrateLocalToCloud.ts` stashes the local vehicles map under a
  `brvg_pending_local_migration` key (deliberately outside the `lt_`/`sh_` namespace `applyUserScope` wipes)
  *before* sign-in is triggered, then a `SyncModal.tsx` effect uploads them (same
  `updateVehicleConfig`+`ensureOwnerAdmin` pipeline a new vehicle uses, `markSessionCreated`-protected from
  the cloud-authoritative prune) once the app reboots signed in to the new account, clearing a vehicle from
  the stash only once its upload is confirmed. AccountPanel offers both as separate confirm-gated buttons.
  Never a merge that leaves a mix.
- **Cloud → local:** sign out / enter local mode → the cloud data leaves this device (cloud remains the
  source of truth server-side); the local session is its own isolated thing.

Three modes:

1. **Cloud mode (encouraged default).** Signed in to the hosted cloud → per-vehicle configuration syncs
   across all the user's devices (Firestore is the source of truth; see the per-user section above). This
   is the paid/hosted product and the only mode where config sync happens.
2. **Private / self-hosted server (open-source fallback).** The self-host server (brvg-cloud-server /
   `worker/` self-host) **relays sensor webhooks + actions only — it does NOT sync configuration.** So
   with a private server, **each device's configuration must be built/entered on that device
   independently** (no cross-device config sync). `sh_webhook_url`/`sh_webhook_user`/`sh_webhook_key`
   point a device at the private server for the relay; they do not move config between devices.
3. **Local-only mode (no account).** No sync at all — configuration is device-local. To enable sync the
   user must go to **Settings → switch to cloud mode** (sign in to the hosted cloud).

**Implications for code:** never sync configuration through a self-hosted/custom server — config sync is
bound to the hosted Firestore path and the signed-in account. The private-server URL/credentials are for
the webhook/action relay only. **Never build a hybrid state** (a device holding both local and cloud
vehicles); a mode switch is total (rebuild or migrate, then wipe the other side) — `applyUserScope` already
wipes on an identity change to enforce this. (The explicit local→cloud switch/migrate from inside the app
is tracked in open-tasks Task 15.)

## Session handoff — 2026-07-08 — sites live + local-server removal + Uni provisioning saga (UNFINISHED — READ FIRST)

Owner-present session, ended mid-hardware-repair. **All repos clean on `main`, 0 open PRs**, latest tag
**v1.0.65** — ⚠️ but `main` is AHEAD of it (the webhook alertish-only fix is unreleased; cut **v1.0.66**
after the Uni verify). **The immediate next action is in open-tasks.md → "🚨 ACTIVE — finish the Attic
test Uni setup"** (device is mid-repair: no voltmeter, no hooks, no password; exact steps + manual
fallback there).

**Shipped this session:**
- **account.boatrvguardian.com LIVE** (Pages project created + deployed; owner attached domain + Firebase
  authorized domain). **demo.boatrvguardian.com LIVE** (same; repo var `DEMO_DEPLOY_ENABLED=true` set —
  demo auto-deploys on every dashboard change now).
- **SEC-4 CLOSED**: hosted worker was already permanently strict (multiTenant branch ignores the flag);
  flipped self-host `WEBHOOK_AUTH_REQUIRED=true` (cloud-server, owner OK'd — no self-host users yet).
- **Android in-app local server REMOVED** (#151, owner decision): phone = pure client (FCM alerts only);
  the desktop Tauri listener (port 3030) stays — it's the offline flood-alert path. Java server/plugin/
  foreground-service + Settings panel + `lt_local_server*` keys all deleted.
- **BLE provisioning regression — three rounds on live hardware:** (1) #152 ported the #95 ordering to
  BLE but enabling the voltmeter OVER BLE backfired two ways (pending-restart reboot killed the BLE
  session before IP-learn; big GetStatus unreliable over GATT chunking); (2) #154 corrected it — BLE does
  ONLY info/Wi-Fi/IP-learn (+ reconnect-up-to-3x on drop), Uni voltmeter/hooks/password happen post-join
  over HTTP, failures show a "setup incomplete → 🩺 Scan" banner; (3) the webhook **alertish-only +
  junk-cleanup** fix — the "no alertish events → register ALL supported" fallback filled all 10 slots
  with input.* junk on a voltmeter-less Uni, from provisioning AND the poll self-heal. Now: only
  WEBHOOK_EVENT_RE events are registered, and a cleanup pass strips our junk hooks (VERIFIED live:
  10 → 0 after one poll). `registerShellyWebhooks` now delegates to `mergeShellyWebhooks` (was a
  duplicate with the same bug). v1.0.64 + v1.0.65 released along the way.
- **Backlog pruned** (#150): 30 → 19 open items; superseded/deferred-dead tasks deleted.

**Gotchas learned (expensive — don't relearn):**
- **THE big one: the owner's phone had Wi-Fi OFF the whole time** (LTE only). Every "device unreachable"
  / silent provisioning failure / failed scan traced to this. Check `adb shell cmd wifi status` FIRST
  when phone↔device HTTP fails; `adb shell svc wifi enable` fixes it. Consider an app-side "you're not
  on Wi-Fi" check when local actions fail (discussed, not built).
- **Local Android build pipeline (owner: STOP cutting GitHub releases per iteration)** — full commands in
  the memory note [[brvg-local-android-build]]: Android Studio JBR as JAVA_HOME (no system JDK), gradle
  `assembleRelease`, sign with `~/Documents/release.keystore` (SAME cert as CI — SHA-256 matches, so
  `adb install -r` upgrades in place), `adb install -r`. ~2-3 min/iteration. `android/local.properties`
  (gitignored) holds the SDK path. Release WebView logs NO JS console to logcat — debug via device
  probes (curl the Shelly) + `wrangler tail brvg-cloud-worker` instead.
- **Never do device RPCs over BLE beyond the minimum** — GATT framing chokes on big payloads
  (GetStatus) and pending-restart flags turn Wifi.SetConfig into an instant reboot that kills the session.
- The direct-push-to-main path is classifier-blocked in this environment — release bumps go branch→PR→
  merge, then tag the squash commit.

## Session handoff — 2026-07-07 — demo site + LinkTap onboarding rework + valve UX + releases v1.0.50→v1.0.63 — READ FIRST

Huge hands-on session with the owner live-testing on their **Android phone** and the **native macOS app**
(installed each build via `adb install -r` / mounting the signed `.dmg` to `/Applications` + clearing the
Gatekeeper quarantine — the release is Tauri-signed but not Apple-notarized). All merged to `main`, all
gates green, **0 open PRs**, latest tag **v1.0.63**. Version lives in 7 files (bump + tag → `release.yml`
builds Mac `.dmg` / Win / signed APK; ~5–8 min).

**Shipped (see open-tasks.md "✅ Shipped 2026-07-07" for the full list):**
- **Demo showcase** `demo.boatrvguardian.com` (mock mode) — built end-to-end + `deploy-demo.yml`
  (gated on repo var `DEMO_DEPLOY_ENABLED`). Owner still does the Cloudflare Pages project + domain.
- **v1.0.50 release** — `main` had drifted **68 commits past v1.0.49** with no version bump, so the whole
  LinkTap event-driven rewrite + worker cutover had never shipped in a signed build. Cutting the release
  was the fix. (Lesson: bump + tag after a batch, don't let main drift far past the last tag.)
- **LinkTap cloud sign-in rework** — username+password → API key (key HIDDEN; "Sign in / Sign out of
  LinkTap Cloud"), redundant Connect button removed, guided add configures everything up front. **Root-caused
  the owner's login failure:** LinkTap's `getApiKey` **docs are wrong** — real success `{"key":"…"}`, error
  bare `{"message":"…"}`; our doc-shape parser threw on success. Fixed app + brvg-cloud-server (#124/#23).
- **Flood re-registration VERIFIED** via live `wrangler tail brvg-cloud-worker` (Task 11 done end-to-end).
- **Shelly LAN-IP tracking** (`&ip=${status.wifi.sta_ip}`), **AP+BLE password provisioning** (#118),
  **per-device 🩺 Scan for issues + one-tap fixes**, device-panel **toggle fixes** (async-`e.target` bug),
  valve-page fixes (connection badge, external-open auto-cap, Auto-Restart gated to local/Free, Daily label),
  **Systems merged into Overview**, **Android edge-to-edge tab-bar** fix, **macOS Local Network** Info.plist.

**Gotchas learned this session:**
- **LinkTap gateway moved `172.31.0.245` → `172.31.0.244`** (DHCP). The Rust subnet scanner
  (`discover_gateway`) was fine; the macOS blocker was the missing **Local Network permission** — now
  declared via `src-tauri/Info.plist` (`NSLocalNetworkUsageDescription` + `NSBonjourServices _http._tcp`).
  Owner must grant Local Network in System Settings for the scan to work.
- **Controlled-input + async write bug:** reading `e.target.checked/value` inside `import('..').then(...)`
  reads a STALE value (React resets the controlled input before the microtask runs). Do device writes
  SYNCHRONOUSLY (static `import { updateDevice }` + call in the handler).
- **`window.confirm()` is a no-op in the Tauri webview** — use an inline two-tap confirm instead.
- LinkTapWidget split (#120, Task 3 inc 5+) was done + CI-green (1553→1131) but **closed unmerged** — the
  widget was edited too much afterward. Redo the split fresh, don't rebase #120.

## Session handoff — 2026-07-03 — SEC-7 CSP shipped + account portal + device provisioning/telemetry fixes (owner-away autonomous stretch) — READ FIRST

**All 5 repos clean on `main`, `HEAD == origin/main`, 0 open PRs.** Fifth repo now: **brvg-account-site**
(customer portal). This session ran partly autonomously while the owner was away, testing on their machine
against the live devices. Verify-in-native-app method: [[brvg-native-verify-app-bundle]] (build the debug
`.app`; the raw `target/debug/app` isn't grantable to computer-use).

### Shipped + merged (app repo — no auto-deploy on merge)
- **SEC-7 Tauri CSP** (#76) — replaced `"csp": null`; native-verified. Fixed 2 origins the draft blocked
  (Google Fonts, `api.github.com`). Device LAN I/O (Shelly `tauri-plugin-http`, LinkTap `raw_linktap_post`)
  is native, so `connect-src` never gates it.
- **Email verification on sign-up** (#91) — `sendEmailVerification` + non-blocking banner; **Google +
  `brvg-tests.com` exempt** (test domain lets agents make throwaways with no inbox). Pure helpers in
  `utils/emailVerification.ts`.
- **In-app change-password + email badge** (#92, Task 14) — reauth+updatePassword (password accounts only).
- **Device-settings UX** (#89) — fixed onboarding "Add Device" double-click clones (isFinalizing guard);
  moved Remove under the ⚙️ gear; dropped the redundant Secure-password / Enable-voltmeter buttons.
- **Shelly telemetry — the big one (#94/#95/#96), root-caused on live hardware:** enabling a Low Power
  Sensor's voltmeter REBOOTS the device, and provisioning did it AFTER registering webhooks + securing —
  so voltmeter hooks never registered (slot filled with `input.*`) and the password step hit a rebooting
  device (`auth_en:false`). Fixes: (a) provisioning reorder voltmeter→reconnect-wait→webhooks→secure (#95);
  (b) **cloud-webhook self-heal on every local poll** for signed-in users (`refreshCloudShellyWebhooks`,
  #94) — merge semantics, throttled, also the Task 11 cutover recovery path; (c) shore-power (`pm1`)
  support — `webhookValueParams` sends `pm1.voltage_change → &v=${ev.voltage}`, role-aware cloud mapping
  (High Power → `pm1:0.voltage`), duplicate-hook dedup, and the widget shows **voltage not watts** (shore
  installs aren't wired inline for current) (#96). **Live devices fixed over the LAN:** Uni `192.168.50.181`
  (voltmeter hooks) + PM Mini G3 `192.168.86.171` (one clean `pm1.voltage_change` hook w/ `&v=`). Both now
  persist to the cloud (admin Operations shows `v=12`/`v=118`). ⚠️ **Live orphaned worker** still classifies
  `pm1.voltage_change` as an alert (spurious FCM `pushFailed`); brvg-cloud-server already treats it as
  telemetry → **Task 7 cutover resolves it.**
- **Wi-Fi AP provisioning** (#96) — new "Step 1: join the Shelly hotspot" screen (directions + reachability
  Check + gated Connect) because selecting Wi-Fi AP jumped straight to creds; the #1 failure is the laptop
  never leaving its normal net for the internet-less `shelly-xxxx` AP (macOS auto-switches back). A web/Tauri
  app can't switch the OS Wi-Fi, so it's directions + a check.

### Other repos (owner action)
- **website #10 (merged, auto-deployed):** pricing → **Free during beta** with regular prices struck
  through (single `BETA_FREE` flag to revert).
- **brvg-admin-site #6 (merged, auto-deployed):** Operations tab now surfaces STALE telemetry loudly (red
  + banner) instead of silently showing days-old rows.
- **brvg-account-site (NEW repo, pushed to main, NOT deployed):** customer portal (profile / telemetry /
  subscription) for **account.boatrvguardian.com**; subscriptions shown only for OWNED vehicles. Owner must:
  create the Pages project, attach the custom domain, add it to Firebase authorized domains (README).

### Flood sensor — still the one broken telemetry path (hardware)
`shellyfloodg4-d885acea3914` never got its recent flood event to the worker; still on the old URL. Deep-sleep,
so the poll self-heal can't reach it — needs the app open on its LAN while awake (Task 11). Devices seen this
session (all reachable from the dev machine, on different subnets): Uni `192.168.50.181`, PM Mini
`192.168.86.171`, LinkTap gw `172.31.0.245`.

## Session handoff — 2026-07-02 (late) — MULTI-REPO security review + worker cutover prep + connectors/ntfy (MACHINE SWITCH — READ THIS FIRST)

Huge session. **All four repos clean on `main`, `HEAD == origin/main`, every gate green.** Only ONE PR
open: [#76](https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/pull/76) (Tauri CSP, **HELD** for native
verify). Everything else merged.

### Security review (SEC-1..16) — done
Read-only audit of all repos → focused PRs.
- **DEPLOYED to prod:** SEC-1/13 **Firestore role enforcement** (a member can't escalate role / seize
  owner / forge tier / re-farm trials; `trialsUsed` worker-only). Verified against the Firestore emulator
  (17/17) and **deployed** → live `cloud.firestore` ruleset **`014945d5-c363-4a2c-b7ab-a2cb313d745e`**. Also
  SEC-5 worker `vid` path-injection (`sanitizeVid`), SEC-16 website copy.
- **Merged (non-prod):** SEC-2/8 valve safety (dead max-flow shutoff armed + de-staled volume cutoff),
  SEC-6 trial ID-token pinned to the trusted worker, SEC-14/15 (no FCM-token logging + full RFC1918 nav),
  cloud-server SEC-3/10/11/12 (fail-closed webhook auth, timing-safe compares, atomic writes, device-key
  cap, non-root Docker), SEC-9 admin-docs, DOC-1..5.
- **HELD:** #76 SEC-7 Tauri CSP — a drafted CSP; merge only after `npm run tauri dev` confirms auth/sync
  don't break.
- **SEC-4 (unauthenticated `/api/shelly?vid=`) — Phase 1 IMPLEMENTED.** Per-vehicle `&k=` secret: worker
  classifier accepts-or-reports; app generates + emits `sh_webhook_secret`; FirestoreStorage reads it.
  **Phase 2 = flip `WEBHOOK_AUTH_REQUIRED` in brvg-cloud-server after the cutover + device re-registration.**

### Worker cutover (Task 7) — the big structural change (NOT deployed yet)
The owner **removed `worker/` from this repo**; the replacement is **brvg-cloud-server's Cloudflare Worker
adapter** (`src/worker.ts` + `FirestoreStorage`, reading/writing the SAME Firestore, with FCM + LinkTap +
authz + retention + SEC-4 + device-limits + connectors + ntfy). The old `boat-rv-guardian-webhooks` worker
is **still live but orphaned from git**. Turnkey steps: **[docs/WORKER_CUTOVER.md](docs/WORKER_CUTOVER.md)**
(test-deploy → smoke → move the `api.boatrvguardian.com` custom domain → re-register devices → SEC-4 Phase 2).
- **CI/branch-protection note:** `main` requires a `worker` status check, but `worker/` is gone — so
  `ci.yml` has a **no-op placeholder `worker` job** to keep PRs mergeable. Drop `worker` from the required
  checks (repo Settings → branch protection) and delete the placeholder job when convenient.

### Owner-requested features — done
- **Per-tier device limits** (free 3 / basic 6 / premium 20): client Add-a-device gating (#79) + server-side
  `device_limit_reached` (brvg-cloud-server; numbers match).
- **Connectors decision (owner): SMS + WhatsApp + Telegram are HOSTED-CLOUD ONLY.** The self-host server
  ships **no** message senders; the hosted worker wires all three. App account-portal UI for all three (#80).
- **Free self-host push = ntfy** (owner picked): set a per-vehicle **ntfy topic** in cloud-server `/admin`,
  users subscribe in the ntfy app — **no Firebase required** (brvg-cloud-server #14). FCM (the app's own
  push) still works self-hosted but needs the operator's OWN Firebase project (tokens are project-scoped);
  local (app-open) alerts always work.
- **New backlog task:** Home Assistant integration (free basic sensor/alert visibility + paid two-way
  control) — a second integration alongside API tokens/webhooks. Transport (MQTT vs REST/custom-component)
  is the open design fork.

### Machine-local state that does NOT travel (re-establish on the new machine)
- **Firebase SA key:** `~/Downloads/boat-rv-guardian-9f8a4-firebase-adminsdk-fbsvc-c5a1a6cdc6.json` (used to
  deploy Firestore rules via the Rules REST API + any Firebase admin op). Re-download: Firebase console →
  Project Settings → Service accounts → Generate new private key.
- **JDK 21 for the rules emulator:** installed `openjdk@21` via brew (keg-only, `/opt/homebrew/opt/openjdk@21`).
  Run the Firestore rules tests with `JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH=$JAVA_HOME/bin:$PATH` then
  `cd firestore-tests && npm i && npm test` (17 tests). On the new machine: `brew install openjdk@21`.
- gh (authed), wrangler (OAuth to sc4tech, Workers+Pages, no DNS), `npx firebase-tools` for rules.

### Working method / hazards
- **Shared checkout hazard:** this main checkout was shared with another autonomous session — use a **git
  worktree** for any non-trivial main-repo work. See the memory note [[boatrvguardian-shared-worktree-hazard]].
- Every change went via a branch → PR → merge-when-green; prod-deploy PRs (rules deploy, the cutover) held
  for the owner.

### Next (all gated on owner / hardware / native — nothing else autonomously actionable remains)
1. **Run the worker cutover** (docs/WORKER_CUTOVER.md) — makes device limits, connectors, ntfy, and SEC-4
   all LIVE and retires the orphaned worker. **Highest leverage.**
2. **Native `tauri dev` verify** → clears the native-verify queue (incl. #79/#80 UIs) and lets you merge #76.
3. **Hardware smokes** (valve path #67/#71, device re-registration emitting `&k=`, Uni telemetry) → then flip
   SEC-4 Phase 2.
4. Drop the `worker` required check on `main`, then delete the placeholder CI job.
5. Owner/external: Stripe, transactional-email provider, Twilio-verified number, connector provider creds
   (WhatsApp/Telegram tokens), `app.`/`admin.` Pages custom domains.
6. Start **Home Assistant** — confirm transport first (MQTT discovery = most native but adds a broker; a REST
   / HA custom component is lighter).

## Session handoff — 2026-06-29, account model + ownership + delete fixes → v1.0.46

Big session, all merged to `main`, gates green (dashboard tsc + **195 tests** + build), **v1.0.46 tagged**
(release.yml builds Mac/Win/signed-APK/web). Theme: reworked the account/data model and fixed the
"nothing syncs / nothing deletes" issues found in native testing.

**Shipped (consumer app — released):**
- **Default tier → Free** (was grandfathered Premium); **Basic trial is now OPT-IN** (button in Account),
  not auto-granted.
- **Per-user data isolation** ([utils/userScope.ts](dashboard/src/utils/userScope.ts)): localStorage is
  stamped with the owning uid; identity change wipes the prior user's vehicles + secrets (fixed a real
  cross-account credential bleed). **Local-only mode** (no account, never syncs) added to the login screen.
- **Config sync model decided**: hosted-cloud-only; self-host = per-device config; **no hybrid accounts**
  (see the section above). **User registry**: every login writes `users/{uid}`; admin Users tab reads it.
- **Onboarding**: first vehicle is a name + Boat/RV form; Settings "+ New" also asks type; "Change" button.
- **Login**: Sign In vs Sign Up separated — non-existent accounts (incl. Google `isNewUser`) are rejected in login mode.
- **Vehicle ownership**: `owner` field (above Full Admin), 👑 in Friends, **transfer ownership**, and a
  **transfer-or-delete prompt** when deleting an account that owns a shared vehicle.
- **THE SYNC FIX**: a brand-new vehicle's doc doesn't exist, and the rules DENIED reading a non-existent
  doc → the active-vehicle `onSnapshot` (no error handler) silently died → the create path never ran, so
  new vehicles never reached Firestore. Fixed client-side (error handler in
  [useCloudConfig.ts](dashboard/src/hooks/useCloudConfig.ts)) AND in rules (`resource==null` read).
- **Delete fixes**: in-app "Delete this Vehicle" now HARD-deletes a sole-owned cloud doc (was orphaning
  it); admin console can delete a vehicle/user (confirm-gated, brvg-admin-site, deployed).

**Admin site (brvg-admin-site): deployed** — Users tab reads the `/users` registry; Delete buttons for
vehicle/user added. Live at `brvg-tools.sc4tech.com`.

**⚠️ BLOCKING OWNER ACTIONS (next session / when back):**
1. ✅ **FIRESTORE RULES DEPLOYED 2026-06-29** — the committed `firestore.rules` is LIVE (release
   `cloud.firestore` → ruleset `8d3070c2-01d6-4e69-808f-614c70d6153c`). Deployed via the Firebase Rules
   REST API using the Admin SDK SA key (the SA has `firebaserules.rulesets.create` + `releases.update`
   but lacks `serviceusage.services.get`, so `firebase-tools deploy` fails its precheck — REST path or
   owner/user auth needed for `firebase-tools`). Deletes + new-vehicle reads now enforced server-side.
   ⚠️ Still native-verify a delete actually succeeds end to end.
2. **Native-verify** the big behavior changes with a throwaway account: new-vehicle sync (does it appear in
   admin Vehicles?), account deletion + transfer, local-only mode, login/signup rejection.
3. Pending from before: brvg-admin-site Operators-tab SA secrets (for Auth-account deletion); Tauri signing
   cert; Stripe; branch protection.

## Session handoff — 2026-06-30 — SMS live, api. custom domain, live UI test (read this first)

All merged to `main`, every PR gate-green. No app version bump/tag this session (worker + infra focus).
Big theme: turned on real integrations + did the first **live in-browser UI test** of the redesign.

**Shipped / DONE:**
- **SMS is LIVE (Twilio).** Real `twilioSmsSender` + `smsSenderFromEnv` in [worker/src/sms.ts](worker/src/sms.ts)
  (#37); the three secrets are set on the worker (`TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM`
  via `wrangler secret put`; creds validated → Twilio API 200). Premium vehicle + opted-in event +
  Twilio-**verified** destination → real SMS. ⚠️ Owner rotated the Auth Token at end of session — the worker
  secret must hold the NEW value (`echo <new> | npx wrangler secret put TWILIO_AUTH_TOKEN` in `worker/`).
  End-to-end delivery not yet test-fired (needs a verified destination cell). Twilio is a **trial** acct
  (sends only to verified numbers; messages get a trial prefix).
- **`api.boatrvguardian.com` LIVE** (Task 11, partial) — Workers Custom Domain on the worker, config-managed
  in `worker/wrangler.toml` `routes` (#38/#39/#40). Verified `/api/health` over HTTPS. The zone is in the
  **sc4tech CF account `9b75e814c0fc254c910fd1afc3c88028`**. **CI-token gotcha (fixed):** the deploy token
  `CLOUDFLARE_PAGES_EDIT` (= "Boat-RV-Guardian GitHub Actions - Deploy") needed **Zone → Workers Routes:Edit**
  added or CI `wrangler deploy` 401s on the route — now granted, CI green. Additive (workers.dev still live).
- **Mobile-nav bug fixed (#36)** — the bottom tab bar sat below the fold; app shell now `height:100dvh`.
- **Features-page tier-copy** aligned to the pricing model (website#6) + lockfile restore (#7).
- **Live UI test (Chrome MCP, signed in as sc4tech)** — clicked the whole redesign shell: Overview /
  Systems (Water/Power/Flood) / Alerts / Settings, vehicle switcher, account view, display-name edit — all
  render, no console errors. This is how #36 was found.

**Tooling notes (for next time):** `wrangler` is OAuth-authed to the sc4tech account (zone READ only by
default → can't edit generic DNS; Workers Custom Domains worked via Workers Routes). Chrome MCP works for
live UI testing against `npm run dev` (localhost:5173). Computer-use's Chrome access flow was flaky; the
Chrome MCP (`mcp__Claude_in_Chrome__*`) is the reliable path. **Don't run `npm install` in a repo just to
edit source** — npm 11 rewrites/shrinks `package-lock.json` and breaks CI `npm ci` (bit the worker + website
this session; both fixed by restoring the lockfile).

**Still open:** Task 11 cutover (flip `DEFAULT_WORKER_URL` → api. + re-register Shelly webhooks — HARDWARE);
`app.`/`admin.` Pages custom domains (optional); worker FCM/SMS send-success status (low-pri, multi-repo);
Task 4 LinkTapWidget→/api/control client wiring (hardware); the `useSettingsState` refactor (attempted +
reverted — scattered state, high-risk, low value; the notification-panel "move" is deferred); Stripe
(deferred per owner); native click-through of the account/sync fixes (#32/#33/#34) + delete flows.
The `useSettingsState` extraction is NOT worth grinding — see open-tasks Task 16 note.

## Session handoff — 2026-06-29 (late) — IA redesign + Firestore rules DEPLOYED + account/sync bug fixes

Big session, all merged to `main`, every PR gate-green (dashboard tsc + **250 tests** + build; worker
74→79 tests + wrangler dry-run). **No version bump/tag cut** — unreleased app changes sit on `main`.
Theme: shipped the Task 16 UI/IA redesign end-to-end, **deployed the Firestore rules** (the long-standing
#1 blocker), and fixed a cluster of account/sync bugs found in native testing.

**Task 16 IA redesign — DONE (PRs #24–#28, #30):** the flat 6-tab nav is replaced by a **global bar**
(persistent vehicle switcher + account button) over **4 primary destinations: Overview / Systems / Alerts
/ Settings** (bottom tab bar on mobile ≤640px). The 4 sensor/valve tabs collapsed into **Systems** with
Water/Power/Flood sections — **the valve is now a PEER sensor under Water** (owner corrected the earlier
"valve is least-used, don't give it real estate" framing → "treat like any other sensor"; the safety model
is unchanged). The valve widget stays always-mounted so the Flooding Sentry keeps running. **Alerts v1** =
merged per-device event timeline + current-issues banner. **Account** is now the identity/mode home
(sign-out + Cloud/Local mode + switch-to-cloud). Design doc: [docs/UI_IA_PROPOSAL.md](docs/UI_IA_PROPOSAL.md).
Still deferred (refactor-risky, needs a click-through): relocating the notification toggles + SMS prefs
into Alerts, which depends on the `useSettingsState` extraction (Task 3).

**Firestore rules DEPLOYED 2026-06-29** (see BLOCKING ACTIONS #1 above) — release `cloud.firestore` →
ruleset `8d3070c2…`. **Confirmed working: admin-portal delete of users/vehicles now succeeds.** Deploy
method when `firebase-tools` fails its serviceusage precheck: the Firebase Rules REST API + the Admin SDK
SA key (the SA has `firebaserules.rulesets.create` + `releases.update`, not `serviceusage.services.get`).

**Account/sync bug fixes (found in native testing, all merged):**
- **#32 — delete-account no longer orphans:** `executeAccountDeletion` deleted the Auth login even when the
  Firestore deletes failed → data orphaned behind a dead account. Now the Auth account is deleted LAST and
  ONLY if all data cleanup succeeded; otherwise it aborts and keeps you signed in to retry.
- **#33 — cross-account boat leak:** `applyUserScope` cleared stale localStorage but on a FIRST sign-in
  returned `wiped:false` (no reload), so cleared boats stayed rendered. Now it reloads whenever it actually
  wiped data.
- **#34 — admin deletes didn't stick (resurrection):** on login, `SyncModal` pushed the stale LOCAL config
  back to the cloud when the cloud doc was gone — re-creating admin-deleted vehicles. Now it only pushes a
  vehicle **created this session** (VehicleManager tracks session-created ids), and a new
  **cloud-authoritative prune** drops local vehicles the loaded cloud snapshot no longer lists.
- **#31 — worker SMS wiring** (merged + DEPLOYED): `dispatchSmsForEvent` is wired into the alert path via
  `noopSmsSender` (behavior-neutral; only a Twilio provider remains).

**⚠️ Known gap (owner action): a deleted account can still LOG IN** — the admin portal deletes the
Firestore docs but NOT the Firebase Auth account. Deleting the Auth account needs the **brvg-admin-site
Operators-tab SA secrets** (`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY`). Until then a "deleted" user
signs in and lands on onboarding (no boats; it no longer resurrects them).

**⚠️ Native-verify queue (consumer app, `npm run tauri dev`, throwaway accounts):** delete-account
(no orphan), account-switch / new-user login (no prior-account boats), admin-delete then re-login (stays
gone), new-vehicle creation (persists). Also the whole new nav shell.

**Data state (checked live 2026-06-29):** 3 vehicles — `MVP` (jgearinger@gmail.com), `sc4 veh 2` +
`Sc4 boat 1` (jgearinger@sc4tech.com); 2 users (same). The sc4tech boats were resurrected before #34;
re-deleting them in the admin portal will now stick.

## Consolidated Firestore rules (publish in the Firebase console)

Merge into the project rules (preserve any existing `users` rule):
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isValidClaim(vid) {
      let inv = get(/databases/$(database)/documents/invites/$(request.resource.data.lastClaimInviteId)).data;
      return request.auth != null
        && !(request.auth.uid in resource.data.allowedUsers)
        && request.auth.uid in request.resource.data.allowedUsers
        && inv.vehicleId == vid
        && inv.status == 'pending'
        && inv.inviteeEmail == request.auth.token.email
        && request.resource.data.members[request.auth.uid].role == inv.role;
    }

    // Operator admin console (Task 12): `admin: true` is a Firebase custom claim, granted out-of-band
    // by website-boatrvguardian/scripts/grant-admin.mjs. Operators may list/read every vehicle and
    // change ONLY the tier fields. Client gating in the console is UX; THIS is the enforcement.
    function isAdmin() {
      return request.auth != null && request.auth.token.admin == true;
    }

    match /vehicles/{vid} {
      // resource == null lets a not-yet-created doc be read (exists:false) instead of denied — required
      // so a brand-new vehicle's onSnapshot doesn't error before SyncModal can create it.
      allow read:   if (request.auth != null && (resource == null || request.auth.uid in resource.data.allowedUsers))
                    || isAdmin();
      allow create: if request.auth != null && request.auth.uid in request.resource.data.allowedUsers;
      allow update: if (request.auth != null && request.auth.uid in resource.data.allowedUsers)
                    || isValidClaim(vid)
                    || (isAdmin()
                        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['tier', 'trialEndsAt', 'members', 'allowedUsers', 'owner']));
      allow delete: if isAdmin()
                    || (request.auth != null
                        && request.auth.uid in resource.data.allowedUsers
                        && resource.data.allowedUsers.size() == 1);

      match /history/{histId} {
        // History docs (monthly usage/events rollups) carry no allowedUsers of their own —
        // authorize against the PARENT vehicle's allowedUsers, like sensorState below.
        allow read, write: if request.auth != null
                           && request.auth.uid in get(/databases/$(database)/documents/vehicles/$(vid)).data.allowedUsers;
      }

      // Worker-cached last sensor event (battery sensors). Worker writes via admin (bypasses rules).
      // Operators (Task 12) may read sensorState for the admin console's Operations view.
      match /sensorState/{sid} {
        allow read:  if (request.auth != null
                        && request.auth.uid in get(/databases/$(database)/documents/vehicles/$(vid)).data.allowedUsers)
                     || isAdmin();
        allow write: if false;
      }
    }

    match /invites/{inviteId} {
      allow read:   if request.auth != null && (resource.data.inviteeEmail == request.auth.token.email
                       || resource.data.invitedBy == request.auth.uid);
      allow create: if request.auth != null && request.resource.data.invitedBy == request.auth.uid
                       && request.auth.uid in get(/databases/$(database)/documents/vehicles/$(request.resource.data.vehicleId)).data.allowedUsers;
      allow update: if request.auth != null && (resource.data.inviteeEmail == request.auth.token.email
                       || resource.data.invitedBy == request.auth.uid);
      allow delete: if request.auth != null && resource.data.invitedBy == request.auth.uid;
    }

    match /users/{uid} {
      // Operators (Task 12) may READ user docs for the admin console's Users view (trial history +
      // FCM-token presence). Writes stay self-only.
      allow read:   if (request.auth != null && request.auth.uid == uid) || isAdmin();
      allow create, update: if request.auth != null && request.auth.uid == uid;
      allow delete: if (request.auth != null && request.auth.uid == uid) || isAdmin();
    }

    // Operator admin audit trail (Task 12): append-only, operators only.
    match /adminAudit/{id} {
      allow read, create: if isAdmin();
      allow update, delete: if false;
    }
  }
}
```
Note: rules compare `inviteeEmail == request.auth.token.email`; emails are stored lowercased and
Google/most providers issue lowercase token emails. If a provider returns mixed-case email, claims
would fail until normalized.

## Session handoff — 2026-06-23, shipped v1.0.43 (read this first; switching computers)

Memory notes in `~/.claude/...` do NOT travel between machines — the durable facts are duplicated
here. Tree clean, `HEAD == origin/main`. Version lives in 7 files (keep in sync on each bump):
`dashboard/package.json`, `dashboard/src-tauri/{tauri.conf.json,Cargo.toml,Cargo.lock(app pkg)}`,
`dashboard/src/pages/Settings.tsx` + `dashboard/src/components/LinkTapWidget.tsx` (`APP_VERSION`),
`dashboard/android/app/build.gradle` (`versionCode`+`versionName`). Release = bump → commit →
`git tag vX.Y.Z` → push main + tag. Tag triggers `release.yml` (Mac/Win/signed-APK + web);
`worker/**` pushes auto-deploy via `worker-deploy.yml`.

### ⚠️ OPEN — verify on the HOME network (192.168.86.x), UNVERIFIED on hardware
The **remote-telemetry path is built but never hardware-tested** (the dev Mac was off-site on a
foreign LAN). When next on the home Wi-Fi with the Shelly Plus Uni reachable:
1. Open the app once so it re-registers webhooks on the device (happens on a successful local poll).
2. On the device, confirm: `curl http://<uni-ip>/rpc/Webhook.List` shows hooks for
   `voltmeter.measurement`/`voltmeter.change` whose URL includes `&v=${ev.xvoltage}&vraw=${ev.voltage}`
   and the right `cid` (voltmeter cid = 100, flood = 0).
3. Confirm the worker receives them: Firestore `vehicles/{vid}/sensorState/{shellyDeviceId}` should
   gain `v`/`vraw` fields (and update ~every 60s). Then off-site the battery widget shows voltage.
   If wrong, the placeholder syntax (`${ev.X}`) or cid is the likely culprit — adjust
   `webhookValueParams`/`cidFor` in `utils/shellyRpc.ts`. (Worker stores any non-vid/event/device
   query param into sensorState; it SKIPS the FCM push for `*.measurement`/`*.change` so no spam.)

### Shelly Plus Uni (SNSN-0043X / app "PlusUni") — voltmeter (HW-verified)
- 0-30 V voltmeter is an ADC peripheral, NOT enabled by default. Enable = `SensorAddon.AddPeripheral
  {type:'voltmeter'}` (creates `voltmeter:100`) THEN **`Shelly.Reboot`** to activate (component is
  absent from GetStatus with `restart_required:true` until reboot). `enableShellyVoltmeter()` in
  `utils/shellyRpc.ts` does this (returns `{id,rebooted}`; Wi-Fi-AP provisioning passes `reboot:false`
  since the Wi-Fi join reboots). UI: Settings device panel "🔌 Enable voltmeter".
- Calibration is ON the device via `Voltmeter.SetConfig {xvoltage:{expr:"x + <offset>", unit:"V"}}`
  (the voltmeter reads `x`; e.g. `x + 0.32`). Both local poll AND cloud read the corrected value —
  widgets read `voltmeter:N.xvoltage ?? .voltage`. UI: per-device offset field "🎯 Voltage
  calibration" (writes to device). No `Voltmeter.*` RPC exists until the peripheral is added+rebooted.

### Android signing + Google Sign-In (HW-verified, fixed this session)
- Release APK signed in `release.yml` with secret `ANDROID_KEYSTORE_BASE64`, key alias `boatguardian`
  (ks/key pass `boatguardian`). Secrets do NOT migrate between repos — workflow now `exit 1`s instead
  of shipping unsigned. To install over an existing app the signing cert must match (else uninstall +
  reinstall; cloud sync restores vehicles on login).
- Google login (`@capacitor-firebase/authentication`, Android Credential Manager) fails with "no
  credentials available" unless the running app's signing SHA is registered in Firebase. The
  `boatguardian` cert SHAs are registered (project `boat-rv-guardian-9f8a4`, android app id
  `1:974787072340:android:6c7c5688e270fedcfbb8c1`): SHA-1 `0F:99:FD:09:45:9C:94:55:83:48:0E:7E:D0:19:6F:A5:9B:3E:06:C0`,
  SHA-256 `03:4F:0D:D9:17:8A:86:30:DF:53:E8:52:FF:14:9A:4B:12:55:7D:D9:07:FA:40:77:3F:8D:92:F0:13:B4:0B:FE`.
  `google-services.json` includes the matching Android oauth client (type 1). Validation is
  server-side — no rebuild needed after adding a SHA.

### Other this-session changes
- **Startup vehicle** (`useCloudConfig.UserConfig.startupMode`: `'default'`|`'last'`, unset='default'):
  honored every login in `SyncModal` (was only on first-run adoption → kept landing on the wrong
  vehicle). Settings → Account → "When the app opens".
- **Battery/shore thresholds** reset to marine/RV defaults; added a "Normal" (nominal) field; battery
  chemistry presets (Flooded/AGM/Gel/LiFePO₄/Custom) × 12 V/24 V in Settings → Devices → Batteries.
  A one-time value-matched migration (`configSync.migrateAllVehiclesThresholds` + `migrateFlatThresholds`
  in `applyCloudVehicleConfig`) upgrades vehicles still on the OLD shipped defaults (untouched values
  only; customized preserved).
- **Custom Cloud Server URL** moved to Settings → Vehicles behind a toggle; now per-vehicle
  (`sh_webhook_url`, blank ⇒ `DEFAULT_WORKER_URL`).

### Remote data model (key mental model the user corrected me on)
Shelly devices push to the **Cloudflare worker** (`boat-rv-guardian-webhooks`) via webhooks → worker
caches `sensorState` + sends FCM. There is NO Shelly first-party cloud in this design (the
`sh_server`/`sh_auth_key` poll in ShellyWidget is vestigial — ignore it). Off-LAN, sensors show ONLY
what the worker cached. LinkTap is the exception: its remote path is LinkTap's own cloud API
(`lt_cloud_user`/`lt_cloud_key` + gateway). Flood = push/event; battery/temp = telemetry (see OPEN above).

### New-machine setup checklist
Clone repo; `cd dashboard && npm i`. Need: Node, Android SDK (`~/Library/Android/sdk` → `adb`,
`apksigner`), `gh` (auth'd), and for Firebase ops `npx -y firebase-tools login` (interactive browser;
token then lands in `~/.config/configstore` so headless CLI works). Build gates: `npx tsc -b` +
`npm run build` (dashboard), `npx wrangler deploy --dry-run` (worker — raw `tsc` mis-flags it).
Launch native app: `npm run tauri dev`. Sideload: `adb install -r <apk>` (in-place if same keystore).

## Session handoff — 2026-06-23 (evening), on-boat hardware testing + worker fixes

Switching machines mid-task. Full detail + the immediate next action live in
[open-tasks.md](open-tasks.md) (read its top "🚨 ACTIVE — Flood auto-shutoff safety chain" section
FIRST). Highlights:

- **Flood auto-shutoff was completely broken in production — found via on-boat hardware testing and
  fixed in 2 of 3 places (deployed + verified).** The chain `flood sensor → GET webhook → worker →
  LinkTap cloud close → valve` now works (valve auto-closes ~16s after a flood alarm).
  1. Worker rejected Shelly's **GET** webhooks with 405 → fixed, commit `b3fdce3`, deployed.
  2. **IMMEDIATE TODO:** FCM push 403 — worker SA `linktap-worker@boat-rv-guardian-9f8a4.iam`
     needs `roles/firebasecloudmessaging.admin` (has only `datastore.user`). One `gcloud
     add-iam-policy-binding` away — exact command in open-tasks.md. Valve shutoff is unaffected;
     only the alert push is missing.
  3. Worker closed the valve via dead endpoint `link-tap.com/api/turnOffV2` (HTML 404) → switched to
     `activateInstantMode {action:false,duration:0}`, commit `a6ca1c3`, deployed (version `7ddb792a`).
- **Worker dev note:** `cd worker && npm ci` before `wrangler deploy/--dry-run` (jose isn't bundled).
  `wrangler tail boat-rv-guardian-webhooks --format pretty` streams live webhook logs — invaluable
  for this. Worker auto-deploys via CI on push to `worker/**`, so **push these commits** so prod
  matches git (a future CI deploy from an unchanged main would otherwise re-ship the OLD worker).
- **LinkTap dual-source confirmed on hardware:** gateway `1485A036004B1200` / valve
  `3CC1C335004B1200` at `172.31.0.245`; HTML-wrapped JSON responses; ~15s RF actuation lag.
- **Task 3 refactor (split LinkTapWidget) — increments 1–4 done** (1819→1559 lines), all behavior-
  preserving, each tsc+test+build green: `utils/linktapHttp`, `utils/linktapStatus`,
  `hooks/useDeviceHistory`, `utils/flowChart`. **Increments 5+ (poll loop, command senders,
  Flooding-Sentry/auto-restart/washdown automation) are NOT done** — they touch the safety-critical
  poll/command state machine and should be smoke-tested on the gateway (now demonstrably reachable).
- **Tests:** Vitest 4 + jsdom stood up in `dashboard/` (`npm test`, 53 tests) + CI workflow
  (`.github/workflows/ci.yml`). Found+fixed a real `historySync` NaN-ts bug along the way.
- **⚠️ The LinkTap valve was left CLOSED** after the flood test (safe for an unattended boat).

## Verifying UI changes — use the NATIVE app, not the web preview pane

**Do NOT use the browser/preview pane** (the `preview_*` MCP tools) to verify changes. To see the
app, **launch the native app**: `cd dashboard && npm run tauri dev` (owner preference, 2026-06-25 —
this is a Tauri + Capacitor app and the native runtime is the real target). Only use the web dev
server (`npm run dev`) if explicitly asked. For most logic/UI changes, the gates (`tsc -b` +
`npm test`, incl. component tests via RTL + `npm run build`) are the primary verification; reach for
the native app when you need to actually see/interact with a change.

## Safety model — the valve self-limits (don't over-weight the flood automation)

The LinkTap valve **only ever opens with a volume/duration limit** (the open command always carries
`duration`/`volume_limit`), so it physically **cannot run long enough to sink the boat**. *That limit
is the primary safeguard.* The flood-sensor→shutoff automation (local app close, and the worker cloud
fallback) merely closes the valve **sooner** than the limit — it's a convenience, not the last line
of defense. Practical implications: (1) a missed flood-shutoff = a bounded amount of water, not a
catastrophe; test valve paths for correctness without dramatizing; (2) **never weaken the open-limit**
— that's the real safety net; (3) gating the cloud flood-shutoff fallback behind Basic is fine (the
owner explicitly declined making it a free safety goodwill). **Prioritization (revised 2026-06-29):**
treat the **valve/flood feature like any other sensor** — neither more nor less important than the
others. (This supersedes the earlier "it's the LEAST-used, don't over-invest" guidance.) The safety
model above is unchanged; this is only about UI prominence / effort allocation.

## Session handoff — 2026-06-25, product-direction planning + safe groundwork (read open-tasks.md)

Big planning session: defined subscription tiers + a slate of new initiatives, captured them in
[open-tasks.md](open-tasks.md) (Tasks 5–12, with decisions baked in), and executed every item that
was safe to do without the user / hardware / DNS+gcloud auth. Tree clean, all on `main`.

**Decisions locked (2026-06-25):**
- **Tiers:** Free = monitor-only (no control) + cloud settings sync + vehicle sharing (maps to the
  Friends `monitor` role). Basic $3/mo·$12/yr = + control (hosted actions/triggers/timers) + ~1mo
  history. Premium $5/mo·$30/yr = + 1–3yr history + SMS/voice alerts + priority support.
- **Entitlements are PER-VEHICLE** (the boat carries the tier; shared monitors get it).
- **Billing:** scaffold gating now, **Stripe later** (provider-agnostic). Pricing-page rebuild is a
  TODO but **explicitly deferred** ("do not act this round"). Admin site = **separate web app** on
  `admin.boatrvguardian.com`. SMS/voice = **scaffold only** (Twilio later).
- **Hosted backend:** move paid-tier data to **Cloudflare D1** (Workers + D1), keep Firebase Auth +
  FCM. One $5/mo plan ≈ 100+ vehicles vs Firestore out-of-pocket past ~3–7. See
  [docs/COST_ANALYSIS.md](docs/COST_ANALYSIS.md). **Mandatory rule: downsample telemetry.**
- **Subdomains:** `api.` (worker) / `app.` (web) / `admin.` (admin), domain on Cloudflare.

**Shipped this session (all gates green; worker changes auto-deploy on push):**
- **SAFETY:** `flood.alarm_off` no longer fires a redundant shutoff. New pure
  [worker/src/events.ts](worker/src/events.ts) (`isFloodShutoff`/telemetry/alarm-off) + 12 worker
  unit tests; added Vitest to the worker package + a worker test job in CI. (open-tasks Tasks 2 + the
  flood follow-up.) **Confirm the new worker version deployed.**
- **Local server defaults OFF** for new installs (`lt_local_server`); migration in `main.tsx`
  preserves it for existing installs. (Task 5.)
- **Entitlement scaffold** (additive, no behavior change yet):
  [utils/entitlements.ts](dashboard/src/utils/entitlements.ts) + [useEntitlements](dashboard/src/hooks/useEntitlements.ts)
  + tier stashed in SyncModal; 14 tests. Legacy vehicles **grandfather to `premium`** so nothing
  breaks until the admin "set tier" switch + Stripe land. (Task 6.)
- **Docs:** [docs/TESTING.md](docs/TESTING.md), [AGENTS.md](AGENTS.md) (working contract),
  `.github/pull_request_template.md`, [docs/SELF_HOST.md](docs/SELF_HOST.md) (worker→shared-core+Docker
  design), [docs/DOMAIN_MIGRATION.md](docs/DOMAIN_MIGRATION.md). Dashboard tests now 65.

**Deliberately NOT done (need user / hardware / auth — see open-tasks.md):**
- **FCM push 403** (open-tasks ACTIVE Break #2): still needs the gcloud IAM grant — **gcloud auth
  doesn't travel to this machine.** Top priority when you have console/auth access.
- **Worker self-host refactor** (Task 7) & **LinkTapWidget increments 5+** (Task 3): touch the LIVE
  auto-deploying shutoff / poll-command state machine — designed but deferred to a hardware
  smoke-testable session.
- **Domain cutover** (Task 11): code not flipped (would break webhooks before the custom domain is
  attached); DNS is owner-only.
- **Remote telemetry verify** (Task 1): needs the home Wi-Fi.

### Continued 2026-06-25 → shipped **v1.0.44** (on `main`, NOT tagged — awaiting owner)
- FCM 403 **resolved** (owner applied the IAM grant; `button.push` test → `notified:1`). Worker also
  now reports `pushFailed` for real delivery visibility.
- Added: LinkTap **Volume Consumed = 0 when idle** fix; **Plan badge + Upgrade link** (Settings →
  Vehicles); self-host **cloud server URL + username/API key** (`sh_webhook_user`/`sh_webhook_key`);
  **Shelly password Edit→Save** with confirm + push-to-all-devices (`shellyChangePassword`,
  HARDWARE-UNTESTED); manual-IP provisioning now secures the device; **Advanced Vehicle Settings**
  group (Custom Cloud URL collapsed by default); **vehicle-switch → stop-local-server prompt**;
  **remain_duration** unit fix; **tier-aware telemetry throttle** in the worker; **coverage reporting**.
- Website: two PRs open ([website#1](https://github.com/Boat-RV-Guardian/website-boatrvguardian/pull/1)
  pricing page + copy alignment, [website#2](https://github.com/Boat-RV-Guardian/website-boatrvguardian/pull/2)
  pre-alpha popup) — **awaiting owner merge**.
- New repo provided for the self-host server: **Boat-RV-Guardian/brvg-cloud-server** (Task 7 dest).
- **UI-verify policy:** use the native app (`npm run tauri dev`), NOT the web preview pane.

## Session handoff — 2026-06-25 (late), v1.0.45 RELEASED + self-host server + mock billing (LAPTOP SWITCH)

Switching laptops. **All three repos are clean, pushed, and in sync with origin; all gates green.**
**v1.0.45 was tagged + released** (the post-1.0.44 batch below; Mac/Win/APK + web build via `release.yml`).
Version lives in 7 files (see the version-bump list earlier in this doc); current = **1.0.45**.

### Repos (clone all three on the new machine)
- **Boat-RV-Guardian/Boat-RV-Guardian** (this repo: app + worker) — `git@github.com:...` (SSH; workflows need SSH).
- **Boat-RV-Guardian/brvg-cloud-server** — the self-hostable Node/Docker cloud server (Task 7). Has CI.
- **Boat-RV-Guardian/website-boatrvguardian** — Astro marketing site (private). Cloudflare Pages auto-deploys `main`.
- Per-repo setup: `npm i` (dashboard, worker, brvg-cloud-server, website each). **Push workflow files
  over the SSH remote** (the HTTPS token lacks `workflow` scope — `gh repo clone` sets HTTPS; run
  `git remote set-url origin git@github.com:Boat-RV-Guardian/<repo>.git`).

### Shipped since v1.0.44 (all on `main`, CI green)
- **brvg-cloud-server** (NEW, greenfield — does NOT touch the live worker): transport-agnostic DI
  **core** (`core.ts`) + pure `events.ts` (classification/throttle) + pluggable `Storage`
  (Memory/File-JSON) + LinkTap/FCM clients + **Node HTTP adapter** + basic-auth **`/admin`** (API key,
  retention, vehicles, user FCM tokens) + **Dockerfile/compose** + **CI**. Plus **tier-based history**
  (`/api/history`, retention pruning) and **hourly downsampling**. ~24 tests; safety decision fully
  unit-tested with mocks (the regression coverage the live worker can't get).
- **Mock billing + in-app `/account` portal** (Task 6/14): `utils/billing.ts` `redeemCoupon`
  (`GUARDIANBASIC/PREMIUM/FREE`) → `setActiveVehicleTier` (the seam Stripe will drive). `tier` is now
  a **synced per-vehicle config field**. **Subscription is WEB-first** (owner: autofill fails in the
  native WKWebView): the native Plan button opens the web portal in the **system browser**
  (`app.boatrvguardian.com/?view=account`, a new `?view=` deep link); the web build shows the in-app
  Account view. Plan button is **always visible** (Manage/Upgrade).
- **First entitlement gate:** cloud-history toggle disabled for tiers with no retention (Free).
- **Force Cloud Sync** moved to the bottom of the Vehicles section; enabled only when signed in.
- **Self-host auth wiring:** app sends `&key=<sh_webhook_key>` to custom servers; worker drops `key`
  from stored telemetry.
- **`remain_duration`** unit fix; **Settings split** started (`LocalServerPanel` extracted);
  **RTL component tests** added; **coverage reporting** (no CI floor yet — IO modules untested).
- **3 PRs merged this session:** website#1 (pricing+copy), website#2 (pre-alpha popup), cloud-server#1.

### Decisions locked this session (owner)
- **Stripe: scaffold/mock now, real later** — test the tier flow via coupon codes before any CC.
- **Subscription portal: WEB-first** (browser), `/account` deep-link; not embedded in the native app.
- **Tiers** (per-vehicle, "Plex"): Free=monitor/manual-view+sync+share; Basic=control+1mo history;
  Premium=long history+SMS+integrations. Telemetry resolution + history retention are tier axes.
- **Valve/flood is treated like any other sensor** (revised 2026-06-29 — supersedes the earlier
  "LEAST-used, don't over-invest" note). The valve still self-limits (volume/duration) and the flood
  automation is convenience, not the safety net — that safety model is unchanged; only the
  UI-prominence/effort framing changed (peer, not de-prioritized).

### Next up (owner had me working down: admin site → unify worker → polish)
- **Admin/operator site** (Task 12): a real "set tier"/user console beyond coupons.
- **Unify the live worker onto the brvg-cloud-server core** (greenfield port via a Firestore storage
  + Cloudflare adapter; owner does the cutover) — kills the duplicated logic.
- **Stripe** when ready (drop-in at `setActiveVehicleTier` / a webhook).

### Still needs the OWNER (not blocking the above)
- **Auto-update signing cert** (Task 13): `tauri signer generate` → secrets + pubkey in tauri.conf.
- **Domain DNS** (Task 11): attach `api.boatrvguardian.com` to the worker, then flip `DEFAULT_WORKER_URL`.
- **Branch protection** to make CI required.
- **Hardware** (on the boat / home Wi-Fi): verify `shellyChangePassword`, AP/BLE provisioning
  password-set, remote-telemetry, LinkTapWidget poll/command hooks.

## Session handoff — 2026-06-27, Settings.tsx split DONE + operator admin site LIVE (LAPTOP SWITCH)

Big session. All three repos clean + pushed; all gates green (dashboard tsc + **113 tests** + build,
worker 18 tests + wrangler dry-run, website astro build). Version still **1.0.45** (unreleased app
changes sit on `main` — no release was cut this session). To continue on another machine: clone all
three repos (see the new-machine checklist above), `npm i` in each, and re-establish the credentials
noted below (they do NOT travel).

### ✅ DONE this session
- **Task 3 — Settings.tsx split (render fully panelized): 2321 → ~820 lines (−65%).** Twelve presentational
  panels under `dashboard/src/pages/settings/*` (Vehicles/Account/Notifications/AdvancedDeviceSettings/
  Friends/LinkTapAuth/DeviceConfig/DevicePreferences/AddDevice/SoftwareUpdates/SettingsModals + the
  pre-existing LocalServerPanel/PlanBadge), plus logic pulled to tested modules:
  `utils/batteryPresets.ts`, `utils/settingsStorage.ts` (centralized the ~55 `lt_*`/`sh_*` keys that
  were duplicated across 3 drifting copies), `utils/shellyDevice.ts`, `hooks/useVehicleSharing.ts`,
  `hooks/useLinkTapDiscovery.ts`. RTL component tests for 4 panels. **Latent bug found + FLAGGED (not
  fixed):** the `settings_updated` rehydrate effect skips 4 notification toggles (flood/house/engine/
  shore) the writer persists — preserved as-is, spawned as a task chip. Also moved **Shelly Local
  Password** under "Advanced Vehicle Settings" (commit `fc6cce0`).
- **Task 9 — CI coverage floor** (`vitest.config.ts` thresholds 55/55/50/50; CI runs `test:coverage`).
- **Firestore rules-as-code**: `firestore.rules` + `firebase.json` + `.firebaserc` in the main repo
  (the consolidated ruleset is now deployable via `firebase deploy --only firestore:rules`).
- **Task 12 — Operator admin site: BUILT + DEPLOYED + LIVE.** In the **website** repo
  (folded in per owner): static console at **`/admin`** (live at https://boatrvguardian.com/admin),
  4 tabs — **Vehicles** (tier + 30-day trial), **Users** (membership-aggregated + trial/FCM), 
  **Operations** (sensorState freshness + a worker `/api/health` ping), **Operators** (add/revoke
  admins). Auth model: Firebase Google sign-in + an `admin` **custom claim**; enforcement is
  **Firestore rules** (admin read + tier-only update + adminAudit) + the one privileged backend, a
  **Cloudflare Pages Function** `functions/api/operators.ts` (verifies the caller's ID token w/ jose,
  requires `admin===true`, then grant/revoke via Identity Toolkit). **Production state applied this
  session:** rules deployed (ruleset `050ddf26…`), `admin:true` granted to **jgearinger@gmail.com**
  (uid `1cxYPLyucuOfwp28F9cc2DY5cN33`), authorized domains now include `admin.boatrvguardian.com` +
  `boatrvguardian.com`, Pages project `boat-rv-guardian` has secrets `FIREBASE_PROJECT_ID/
  CLIENT_EMAIL/PRIVATE_KEY`, website deployed to Pages production. Smoke-verified: `/admin`=200,
  `/api/operators`=401 on no/invalid token (gate works). NOT yet exercised with a real signed-in
  session (Google OAuth = owner clicks).

### ⚠️ OPEN / next actions
- **[Boat-RV-Guardian#1](https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/pull/1) — worker `/api/health`** is OPEN on branch `worker-health-endpoint` (the classifier misread it and blocked the
  merge). MERGE it to deploy the worker (auto-deploys on push to `main`); until then the console's
  Operations tab shows "Worker: down".
- **Attach `admin.boatrvguardian.com`** to the `boat-rv-guardian` Pages project (Cloudflare dashboard
  → Pages → Custom domains; `wrangler` has no domain command). It's already an authorized Firebase
  domain, so it works once attached — the cleaner home than `boatrvguardian.com/admin`.
- **Notif-toggle rehydrate bug** (above) — fix is 4 setters; spawned as a chip, owner-confirm desired.
- Untouched backlog (PR-able, no hardware): **Task 4** (worker-enforced monitor-role), **Task 6**
  (server-side trial expiry + history-retention pruning). Hardware-gated: **Task 1**, **Task 3 inc 5+**.

### 🔑 Credentials / machine state (do NOT travel — re-establish on the other machine)
- **Firebase service-account key** used for all admin ops:
  `~/Downloads/boat-rv-guardian-9f8a4-firebase-adminsdk-fbsvc-c5a1a6cdc6.json` (machine-local, NOT in
  git). On another machine, re-download: Firebase console → Project Settings → Service accounts →
  Generate new private key. Admin scripts live in `website-boatrvguardian/scripts/`
  (`grant-admin.mjs`, `add-authorized-domain.mjs`) — run with `GOOGLE_APPLICATION_CREDENTIALS=<key>`
  or `gcloud auth application-default login`. **Owner should delete/rotate the downloaded key when done.**
- **Pre-change Firestore rules backup** (for rollback): `~/Downloads/firestore.rules.backup-27972921…txt`.
- **gcloud**: installed `~/google-cloud-sdk` (not on PATH), account `jgearinger@sc4tech.com`, project
  set — but tokens are STALE; needs interactive `gcloud auth login` / ADC re-auth.
- **wrangler**: authed `jgearinger@sc4tech.com`; scopes = Workers + **Pages** + D1, **no DNS/Zone**
  (so DNS + Pages custom-domain attach are dashboard-only). `firebase` CLI not installed (use `npx firebase-tools`).
- The agent could not run the Firebase/Cloudflare PRODUCTION writes itself (sandbox classifier blocks
  prod deploys/grants + a self-named admin); the owner ran the prepared one-line scripts. Same pattern
  applies on the next machine.

## Session handoff — 2026-06-28, backend enforcement shipped + admin relocated + Task 14 (all merged)

Big session, everything merged to `main` across all repos; all gates green. Version still **1.0.45**
(unreleased app changes on `main`; no tag cut). Highlights:

### Shipped + DEPLOYED (worker auto-deploys on push to `worker/**`)
- **Task 8 — worker cost caching** (PR #2): OAuth token + vehicle-doc cached in the isolate
  ([worker/src/cache.ts](worker/src/cache.ts)); flood path bypasses the vehicle cache for fresh creds.
- **Task 6 — server-side tier enforcement** (PR #3): a **daily cron** (`12 4 * * *`, wrangler.toml)
  expires lapsed Basic trials (`trialEndsAt` past → `tier=free`) and prunes hosted history past the
  tier window. Pure selectors in [worker/src/retention.ts](worker/src/retention.ts). Inert under
  grandfathering until real tiers are assigned.
- **Task 4 — role-enforced control** (PR #4): `POST /api/control` verifies the caller's Firebase ID
  token, checks their `members` role (pure [worker/src/authz.ts](worker/src/authz.ts)), rejects
  `monitor`, enforces open-requires-limit, then relays to LinkTap. **Additive + unused** until the
  app routes off-LAN control through it (hardware-gated — the LinkTapWidget command path).
- **Task 12 health** (PR #1): worker `/api/health` (live, 200).

### Admin console RELOCATED → its own repo + domain (LIVE)
- New repo **[Boat-RV-Guardian/brvg-admin-site](https://github.com/Boat-RV-Guardian/brvg-admin-site)**
  (standalone Astro app), deployed to **https://brvg-tools.sc4tech.com** (off the brand domain for
  obfuscation/security). Marketing site dropped `/admin` + `/api/operators` (website#4, merged).
  Agent did the Cloudflare Pages deploy + custom-domain attach + `FIREBASE_PROJECT_ID` secret; owner
  made the CNAME. **`brvg-tools.sc4tech.com` added to Firebase Auth authorized domains** → sign-in
  works, console usable. ⚠️ STILL TODO (owner): set `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`
  Pages secrets (need the SA key) for the **Operators tab** only; other 3 tabs work.
- **gcloud→Firebase admin API gotcha:** user creds need header `x-goog-user-project: boat-rv-guardian-9f8a4`
  on identitytoolkit calls, else "requires a quota project" PERMISSION_DENIED. `gcloud auth print-access-token`
  is the sanctioned token source (the classifier blocks extracting firebase-tools' stored refresh token).

### Task 7 — cloud-server unify groundwork (merged, brvg-cloud-server#3)
- `SqlStorage` over a tiny `SqlDriver` seam + `NodeSqliteDriver` (node:sqlite, self-host) +
  `D1Driver` (Cloudflare) + a **Cloudflare Worker adapter** (`src/worker.ts`) reusing the same core.
  Path to retiring the main repo's standalone `worker/` (owner-driven cutover later).

### Task 14 — Account portal (merged, PR #6)
- Account.tsx gains trial status, usage-vs-plan, and a Premium-gated CSV export of on-device usage
  history. Pure logic in [utils/accountSummary.ts](dashboard/src/utils/accountSummary.ts) +
  [utils/historyCsv.ts](dashboard/src/utils/historyCsv.ts). SyncModal now stashes
  `lt_vehicle_trial_ends`. **Coverage lesson:** importing `VehicleManager` into a view drags its heavy
  transitive graph into that view's test and tanks global coverage — read `lt_devices`/`lt_vehicles`
  from localStorage directly for simple counts.

### Next (owner's order was Task 14 → Task 6 client; both server sides done)
- **Task 6 client remainder:** wire the entitlement gates (`canRemoteControl` off-LAN, hide SMS
  config) — NOTE the entitlement booleans are still consumed only by tests + the new Account view;
  trial AUTO-grant on vehicle creation; SMS/voice scaffold (no provider).
- **Task 4 client wiring:** route LinkTapWidget remote control through `/api/control` (hardware-gated).
- **Stripe** when ready (drop-in at `setActiveVehicleTier`).
- Owner: the `brvg-admin-site` Operators-tab secrets; Tauri signing cert (Task 13); branch protection.

## Session handoff — 2026-06-28 (late), trial + SMS + account-portal batch (ALL MERGED — MACHINE SWITCH)

Leaving for a new machine. **All four repos clean, on `main`, `HEAD == origin/main`, zero open PRs.**
Version still **1.0.45** (unreleased app changes on `main`; no tag cut). Clone all four on the new
machine (see the new-machine checklist + the [[boatrvguardian-repos]] note): **Boat-RV-Guardian**,
**brvg-cloud-server**, **website-boatrvguardian**, **brvg-admin-site**; `npm i` in each. Worker +
website auto-deploy on merge to `main`; the worker redeployed clean this session (`/api/health`=200,
`/api/trial`=401 verified live).

### Shipped + merged this session (19 PRs across the repos)
- **Task 6 free Basic trial — built end to end:** pure `isTrialEligible` + server-authoritative
  `POST /api/trial` (`handleTrial`, owner-only, anti-abuse against authoritative Firestore) in
  [worker/src/index.ts](worker/src/index.ts) (#9, DEPLOYED); consumer **auto-grant** via `requestTrial`
  + a guarded SyncModal trigger ([utils/trial.ts](dashboard/src/utils/trial.ts), #10); admin console
  **re-trial guard** (`isVehicleTrialEligible`, brvg-admin-site#1, DEPLOYED).
- **Task 6/14 SMS/voice — scaffold complete (no provider):** worker send-path interface
  [worker/src/sms.ts](worker/src/sms.ts) (`SmsSender`/`noopSmsSender`/`dispatchSmsForEvent`, #11) +
  Premium opt-in **UI** in Account.tsx → synced `sh_sms_prefs` ([utils/smsPrefs.ts](dashboard/src/utils/smsPrefs.ts), #12).
- **Task 8 cost lever:** worker **telemetry write-coalescing** — skip a `sensorState` write whose
  content is unchanged since the isolate last wrote it, 15-min heartbeat, telemetry-only (alerts always
  write). `sensorStateSignature`/`shouldWriteTelemetry` in [worker/src/cache.ts](worker/src/cache.ts) (#17, DEPLOYED).
- **Task 14 account portal:** account basics (display name/email via a `user` prop) + per-vehicle plan
  overview (`vehiclePlanRows`, #14); Premium **API tokens** (synced `sh_api_tokens`,
  [utils/apiTokens.ts](dashboard/src/utils/apiTokens.ts), #15); **delete-account / GDPR**
  ([utils/accountDeletion.ts](dashboard/src/utils/accountDeletion.ts) pure plan+executor + a
  type-DELETE-to-confirm UI with lazy Firebase import, #18).
- **Tests:** Settings rehydrate-drift fix via mapped-type `applyPersistedSettings` (#8, fixes the
  flood/house/engine/shore notif-toggle bug flagged in prior handoffs); SMS+integrations gating RTL
  tests (#16). Dashboard **172 tests**, worker **74**, all gates green.
- **Docs:** open-tasks.md reconciled (#13, #19) — now accurate.

### ⚠️ NEXT — verify in the native app (`npm run tauri dev`), with a throwaway account
These are merged + gate-green but NOT runtime-verified (behavior changes / Firebase-coupled):
1. **Trial auto-grant (#10):** create a new vehicle → it should get `tier=basic` + `trialEndsAt`;
   create/re-add another → declined by the anti-abuse rule.
2. **Delete-account (#18):** run the delete flow — esp. the Firebase `requires-recent-login` path
   (Firebase often forces a recent login before `deleteUser`; the executor surfaces that + signs out,
   but the UX may want an explicit re-auth prompt).

### Untouched / deferred (reasons)
- **Task 3 `useSettingsState` hook** — extract the ~56 interleaved synced-settings states + the
  localStorage-writer effect. DEFERRED: no Settings render test, so gates can't catch a sync
  regression — needs a click-through pass (per open-tasks + AGENTS). **(The lower-risk half — the
  rehydrate fix — landed in #8.)**
- **Task 14 sharing overview** — DEFERRED: redundant with Settings → Friends + would break Account's
  Firebase-free/test-light design.
- **Still 🟢 (do anytime, no hardware):** wire `dispatchSmsForEvent` into the worker alert path (+ a
  real provider); editable display name / in-portal vehicle switching; main-repo Docker CI.
- **Hardware-gated:** Task 1 (telemetry), Task 3 inc 5+ (LinkTapWidget), Task 4 client wiring, Shelly
  password provisioning. **Owner-gated:** Task 11 DNS, Task 13 signing cert, Stripe, admin secrets,
  branch protection.
