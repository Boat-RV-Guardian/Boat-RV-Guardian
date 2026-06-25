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
  `DB_PATH`, `PORT`.
- `worker/README.md` (or the future dedicated repo): self-host quickstart.

## Migration steps (each its own small, green PR; hardware-smoke the safety ones)

1. ✅ Extract `events.ts` (pure) + worker Vitest. **Done.**
2. ▢ Extract `linktap.ts` + `notify.ts` + `storage.ts` (FirestoreStorage) — pure-ish, behavior-
   preserving. Add core handler with DI; `index.ts`/`adapters/cloudflare.ts` wires Firestore+FCM.
   Cover the safety decision end-to-end with mocked deps. **Smoke-test the shutoff on hardware.**
3. ▢ Add `node.ts` + Dockerfile + compose + README. CI: build the image.
4. ▢ Add `D1Storage` + `SqliteStorage`; wire telemetry downsampling/retention. Migrate hosted
   sensorState + history to D1 (keep Firestore for config/auth+FCM). **Smoke-test telemetry + flood.**
5. ▢ (Later) Extract the server into its own public repo (the open-source deliverable) — see Task 7
   note in open-tasks.md. Keep `worker/**` auto-deploy or move it to the new repo's CI.

## Why not just keep Cloudflare-only?

Self-host is the free/open-source promise and a trust signal for a safety product (owners can run
their own flood protection with no vendor). D1=SQLite makes the hosted↔self-host gap small enough that
one shared core serves both without a second codebase.
