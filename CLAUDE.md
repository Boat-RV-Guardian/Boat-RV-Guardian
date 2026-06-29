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
- **Local → cloud:** either **rebuild** the vehicles in the cloud (the current behavior — signing into a
  cloud account from local mode **wipes** the local session via `applyUserScope`, so you start clean in the
  cloud) OR a future **"migrate local account to the cloud"** flow that uploads the local vehicles, then
  switches the device to cloud mode. Never a merge that leaves a mix.
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
      allow read:   if (request.auth != null && request.auth.uid in resource.data.allowedUsers)
                    || isAdmin();
      allow create: if request.auth != null && request.auth.uid in request.resource.data.allowedUsers;
      allow update: if (request.auth != null && request.auth.uid in resource.data.allowedUsers)
                    || isValidClaim(vid)
                    || (isAdmin()
                        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['tier', 'trialEndsAt']));
      allow delete: if false;

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
      allow read:  if (request.auth != null && request.auth.uid == uid) || isAdmin();
      allow write: if request.auth != null && request.auth.uid == uid;
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
owner explicitly declined making it a free safety goodwill). **Prioritization:** the owner expects
the **valve/flood feature to be the LEAST-used** part of the product — don't over-invest in it;
monitoring / remote-view / history / alerts get used far more and deserve the effort.

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
- **Valve/flood is the LEAST-used feature** and the valve self-limits (volume/duration) — don't
  over-invest; the flood automation is convenience, not the safety net.

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
