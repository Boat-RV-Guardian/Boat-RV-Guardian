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

    match /vehicles/{vid} {
      allow read:   if request.auth != null && request.auth.uid in resource.data.allowedUsers;
      allow create: if request.auth != null && request.auth.uid in request.resource.data.allowedUsers;
      allow update: if (request.auth != null && request.auth.uid in resource.data.allowedUsers)
                    || isValidClaim(vid);
      allow delete: if false;

      match /history/{histId} {
        // History docs (monthly usage/events rollups) carry no allowedUsers of their own —
        // authorize against the PARENT vehicle's allowedUsers, like sensorState below.
        allow read, write: if request.auth != null
                           && request.auth.uid in get(/databases/$(database)/documents/vehicles/$(vid)).data.allowedUsers;
      }

      // Worker-cached last sensor event (battery sensors). Worker writes via admin (bypasses rules).
      match /sensorState/{sid} {
        allow read:  if request.auth != null
                     && request.auth.uid in get(/databases/$(database)/documents/vehicles/$(vid)).data.allowedUsers;
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
      allow read, write: if request.auth != null && request.auth.uid == uid;
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
