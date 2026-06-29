# Self-hostable webhooks/actions server — architecture & plan

Created 2026-06-25 (open-tasks Task 7). **Design only — not yet implemented.** The worker is the
**live, safety-critical** flood-shutoff path and **auto-deploys to production on push to `worker/**`**
(`worker-deploy.yml`), so the refactor below should be executed when it can be **hardware
smoke-tested** (see docs/TESTING.md), not blind.

## Goal

Make the webhooks/actions server a **deployable, self-hostable product** so the open-source story is
real: the same logic runs on **Cloudflare Workers (hosted)** and as a **Node/Docker container
(self-host)**. Per the cost analysis (docs/COST_ANALYSIS.md), hosted storage should move to
**Cloudflare D1 (SQLite)**, which also means self-host can use plain SQLite/libSQL — *same SQL*.

> **Scope: relay only — NO configuration sync (owner decision, 2026-06-29).** A self-hosted/private
> server handles the **sensor webhook + action relay** (and its own telemetry/history) — it does **not**
> sync app configuration between devices. **Configuration sync is a hosted-BoatRVGuardian-cloud feature
> only.** With a private server, each device's configuration is built independently on that device. The
> product encourages hosted cloud use and treats self-host as the open-source fallback. See the
> "Configuration sync model" section in [CLAUDE.md](../CLAUDE.md).

## Shape: shared core + thin adapters + pluggable storage

```
worker/src/
  events.ts        ✅ DONE — pure event classification + param extraction (no I/O)
  core.ts          ▢ pure request handler: takes (deps) → returns a result, no platform globals
  storage.ts       ▢ Storage interface (get vehicle config, write sensorState, read/write history)
  notify.ts        ▢ Notifier interface (FCM push; later SMS/voice)
  linktap.ts       ▢ LinkTap cloud client (shutoff/activateInstantMode) — already mostly isolated
  adapters/
    cloudflare.ts  ▢ Worker `fetch` entry → builds Firestore/FCM deps, calls core (today's index.ts)
    node.ts        ▢ http.createServer entry → builds SQLite/FCM deps, calls core
  index.ts         ▢ re-exports the Cloudflare adapter (keeps wrangler entry stable)
```

**Dependency-injection seam.** `core.handleShellyWebhook(url, deps)` where:

```ts
interface Deps {
  storage: Storage;        // see below
  notify: Notifier;        // sendPush(uid, title, body)
  linktap: LinkTapClient;  // shutoff(config) with retry
  now: () => number;       // injectable for tests
}
```

This is what makes the safety path **unit-testable end to end** (mock deps, assert "flood.alarm →
linktap.shutoff called; flood.alarm_off → not called") — the regression guard docs/TESTING.md wants.

### Storage interface (pluggable)

```ts
interface Storage {
  getVehicle(vid: string): Promise<VehicleConfig | null>;
  putSensorState(vid: string, device: string, state: SensorState): Promise<void>;
  appendHistory(vid: string, device: string, sample: Sample): Promise<void>; // honors retention
}
```

- **Hosted:** `FirestoreStorage` today; migrate sensorState + history to `D1Storage` (cost analysis).
- **Self-host:** `SqliteStorage` (better-sqlite3 / libSQL) — same schema as D1.
- Config docs (`getVehicle`) can stay Firestore short-term (low volume) or move to D1 for one vendor.

> Apply the cost levers in the storage layer: **downsample telemetry** (raw recent window → hourly
> long-term), cache the vehicle doc, coalesce writes. See docs/COST_ANALYSIS.md §5.

### Notifier interface

`FcmNotifier` (today's `sendFcmPush`). Premium SMS/voice (Task 6, scaffold-only now) becomes a second
`Notifier` impl (e.g. Twilio) selected by entitlement — keep the interface ready, no live provider yet.

## Node/Docker adapter

- `adapters/node.ts`: `http.createServer` mapping `GET/POST /api/shelly` → `core.handleShellyWebhook`.
  Node 20 has global `fetch`, so the LinkTap/FCM HTTP calls port unchanged.
- `Dockerfile` (multi-stage: build TS → slim runtime), `docker-compose.yml` (server + a volume for
  the SQLite db). Config via env: `FIREBASE_*` (for FCM/Firestore if used), `STORAGE=sqlite|d1`,
  `DB_PATH`, `PORT`, `ADMIN_PASSWORD` (or first-run setup).
- `worker/README.md` (or the future dedicated repo): self-host quickstart.

### Self-host admin page (bundled, "really basic")

The Docker image serves a small admin UI (e.g. at `/admin`) so a self-hoster can configure their
instance without editing files. **This is the SELF-HOST instance admin — distinct from Task 12, the
hosted SaaS operator console.** Requirements (2026-06-25):

- **First-run setup / auth:** set an admin password on first launch (or via `ADMIN_PASSWORD`); the
  admin page is password-gated.
- **Usernames:** create/manage the local user(s) allowed to use this instance (the people whose app
  talks to it). Minimal — username + access, no SaaS tiers here.
- **API key:** generate / view / rotate the API key the dashboard app (and device webhooks) use to
  authenticate to this self-hosted server. (This is the local-auth seam.)
- **Data limits:** retention (auto-**delete data older than N days**), max storage / DB size cap, and
  a manual **"purge old data now"** action — important because self-host has finite disk.
- **Status (basic):** current storage used, row counts, recent webhook activity.

Implementation: a tiny server-rendered page or a few JSON endpoints (`/admin/api/*`) + minimal HTML;
config persisted in the SQLite db (a `settings` table) or a mounted config file. No heavy framework —
keep it dependency-light so the image stays small. Build it alongside the Node adapter (Increment 3).

**App ↔ self-host server auth contract.** The app already has per-vehicle fields for this
(`sh_webhook_url` + `sh_webhook_user` + `sh_webhook_key` in `configSync.ts`, edited under Settings →
Vehicles → Custom Cloud Server URL). The admin page issues the username + API key; the app sends them
to the server. Proposed contract (define here since we own both sides):
- **Device webhooks** (Shelly POSTs, can't send headers easily): authenticate with the key as a query
  param — `…/api/shelly?vid=…&event=…&key=<sh_webhook_key>`. The server rejects unknown keys.
- **App→server API** (admin/control calls): HTTP Basic or a bearer token from `user:key`.
- ⏳ **Wiring TODO:** `ProvisionShellyModal` currently builds the webhook base from `sh_webhook_url`
  only — once the server exists, append `&key=<sh_webhook_key>` (only for custom servers, not the
  default hosted worker) so devices authenticate. The fields are stored now; the send-side wiring
  lands with the server (Increment 3) so it can be tested against a real instance.

## Migration steps (each its own small, green PR; hardware-smoke the safety ones)

1. ✅ Extract `events.ts` (pure) + worker Vitest. **Done.**
2. ▢ Extract `linktap.ts` + `notify.ts` + `storage.ts` (FirestoreStorage) — pure-ish, behavior-
   preserving. Add core handler with DI; `index.ts`/`adapters/cloudflare.ts` wires Firestore+FCM.
   Cover the safety decision end-to-end with mocked deps. **Smoke-test the shutoff on hardware.**
3. ▢ Add `node.ts` + Dockerfile + compose + README. CI: build the image.
4. ▢ Add `D1Storage` + `SqliteStorage`; wire telemetry downsampling/retention. Migrate hosted
   sensorState + history to D1 (keep Firestore for config/auth+FCM). **Smoke-test telemetry + flood.**
5. ▢ (Later) Extract the server into **[Boat-RV-Guardian/brvg-cloud-server](https://github.com/Boat-RV-Guardian/brvg-cloud-server)**
   (repo provided by owner 2026-06-25) — the open-source deliverable. Move the shared core + adapters
   + Dockerfile + self-host admin page there once increments 2–4 stabilize; keep `worker/**`
   auto-deploy or move it to the new repo's CI.

## Why not just keep Cloudflare-only?

Self-host is the free/open-source promise and a trust signal for a safety product (owners can run
their own flood protection with no vendor). D1=SQLite makes the hosted↔self-host gap small enough that
one shared core serves both without a second codebase.
