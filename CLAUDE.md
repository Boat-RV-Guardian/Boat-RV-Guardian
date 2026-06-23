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
        allow read:   if request.auth != null && request.auth.uid in resource.data.allowedUsers;
        allow create: if request.auth != null && request.auth.uid in request.resource.data.allowedUsers;
        allow update: if request.auth != null && request.auth.uid in resource.data.allowedUsers;
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
