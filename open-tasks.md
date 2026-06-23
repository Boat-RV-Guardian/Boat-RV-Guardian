# Open Tasks

Working backlog for Boat & RV Guardian. Created 2026-06-23. Grounded in the current
`dashboard/`, `worker/` source and `CLAUDE.md`. Check items off as they land; keep this
file in sync with reality (delete tasks that become obsolete, like the old "split App.tsx"
note — `App.tsx` is now only 159 lines).

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

- [ ] Add Vitest to `dashboard/` (`npm i -D vitest`, add `"test": "vitest"` to
      [package.json](dashboard/package.json) scripts; reuse the existing Vite config).
- [ ] Unit-test the time policy in [utils/time.ts](dashboard/src/utils/time.ts)
      (`formatTime` / `formatDate` / `formatDateTime` — UTC storage, `lt_tz` display, fallbacks).
- [ ] Unit-test the threshold/config migrations in
      [utils/configSync.ts](dashboard/src/utils/configSync.ts)
      (`migrateAllVehiclesThresholds`, `migrateFlatThresholds`, `LOCAL_ONLY_KEYS` handling) —
      these mutate persisted user data, so regressions are costly.
- [ ] Unit-test role resolution in [utils/sharing.ts](dashboard/src/utils/sharing.ts)
      (`getMyRole`, legacy-member-as-admin, `ensureOwnerAdmin`).
- [ ] Unit-test the Shelly webhook param builders in
      [utils/shellyRpc.ts](dashboard/src/utils/shellyRpc.ts) (`webhookValueParams`, `cidFor`) —
      ties directly into Task 1.
- [ ] Unit-test history merge logic in [utils/historySync.ts](dashboard/src/utils/historySync.ts)
      (usage = max per bucket, events = dedup by `ts|message`).
- [ ] Add a worker typecheck/test gate: [worker/src/index.ts](worker/src/index.ts) parses query
      params into `sensorState` and skips FCM for `*.measurement`/`*.change` — cover that branch.
- [ ] Wire `npm test` into CI so PRs run it (see `.github/workflows/`).

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
