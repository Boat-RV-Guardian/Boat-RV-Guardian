# Testing strategy — Boat & RV Guardian

Created 2026-06-25 (open-tasks Task 9). Goal: **as rapid development accelerates, don't break what
already works** — especially the safety-critical flood→shutoff chain. This doc defines what we test,
how, and the gates that must pass before merge.

## Why this matters here

This app controls **physical water valves on unattended boats/RVs**, and much of the logic can't be
exercised without real hardware (a sleeping flood sensor, a LinkTap gateway over RF). So our strategy
is: **push as much logic as possible into pure, unit-tested functions**, and keep an explicit
**manual hardware smoke-test checklist** for the irreducible rest.

**Calibrate the stakes correctly** (owner, 2026-06-25): the LinkTap valve only opens with a
volume/duration **limit**, so it physically can't run long enough to sink the boat — *that limit* is
the primary safeguard. The flood→shutoff automation just closes the valve sooner; a missed shutoff
means a bounded amount of water, not a sunk boat. So test the valve paths for **correctness** (no
spurious open, no broken close, and **never drop the open-limit**), without treating a missed
flood-automation as catastrophic.

## The pyramid (what lives where)

1. **Pure util / logic unit tests (the bulk).** Vitest. Anything that can be a pure function should
   be — then it's trivially tested without mocking I/O. Examples already in the repo:
   - `dashboard/src/utils/` — time policy (`time.ts`), config/threshold migrations (`configSync.ts`),
     role resolution (`sharing.ts`), Shelly webhook param builders (`shellyRpc.ts`), history merge
     (`historySync.ts`), LinkTap transport/status helpers (`linktapHttp.ts`, `linktapStatus.ts`),
     flow chart (`flowChart.ts`).
   - `worker/src/events.ts` — flood/telemetry/alarm-off classification + sensorState param extraction.
   - **Pattern:** when you find logic inlined in a component or the worker `fetch` handler, extract it
     to a pure module and test it (this is how `events.ts` and the LinkTap utils were born).

2. **Hook tests (growing).** Once Task 3 extracts the LinkTap poll loop / automation into hooks, test
   them with `@testing-library/react`'s `renderHook` + fake timers. Until then, keep new stateful
   logic in hooks from day one so it's testable.

3. **Light component / integration tests.** For role-gating UI, entitlement gates, and any
   conditional rendering that encodes a rule. Render, assert the gated control is present/absent.
   **Infra is in place** (`@testing-library/react`, jsdom) — first example:
   `src/pages/settings/SubscriptionPanel.test.tsx` renders the real panel through the real
   `useEntitlements` hook, driven by `localStorage`. Use this pattern for new gated UI.

4. **Worker integration regression (safety).** A test that replays a `flood.alarm` GET against the
   worker's classification + close-decision path and asserts: real alarm → shutoff intended;
   `flood.alarm_off` / `*.measurement` / `*.change` → **no** shutoff. (The pure `isFloodShutoff`
   tests cover the decision today; expand toward the handler as it's refactored to be injectable.)

5. **Manual hardware smoke test (irreducible).** See the checklist below. Required before any release
   that touches the poll loop, command senders, the Flooding Sentry automation, or the worker
   shutoff path.

## Running tests

- Dashboard: `cd dashboard && npm test` (or `npm run test:watch`). Config: `dashboard/vitest.config.ts`,
  jsdom + a Map-backed `localStorage` shim in `dashboard/src/test/setup.ts`. Tests are excluded from
  the production `tsc -b`.
- Worker: `cd worker && npm test` (Vitest, node env, `worker/vitest.config.ts`).

## CI gates (must pass before merge)

Enforced by [.github/workflows/ci.yml](../.github/workflows/ci.yml) on every PR + push to main:

| Gate | Command | Where |
|---|---|---|
| Dashboard typecheck | `npx tsc -b` | `dashboard/` |
| Dashboard unit tests | `npm test` | `dashboard/` |
| Worker type gate | `npx wrangler deploy --dry-run` | `worker/` (raw `tsc` mis-flags it — see CLAUDE.md) |
| Worker unit tests | `npm test` | `worker/` |

**Do not merge red.** If a gate can't pass, the change isn't done (see AGENTS.md).

Planned additions: coverage reporting + a floor (don't let it regress); the Docker image build once
Task 7 lands; required-status-check branch protection.

## What every change should add

- **New feature → new test.** No exceptions for logic. UI-only/style changes are exempt.
- **Bug fix → a test that fails before the fix.** (E.g. the `historySync` NaN-ts bug and the
  `flood.alarm_off` shutoff both got regression tests.)
- **Refactor → behavior-preserving, verified each increment** by `tsc` + tests + a real build. The
  Task 3 LinkTapWidget extraction is the model: small increments, green at every step.

## Manual hardware smoke-test checklist (safety-critical)

Run on the boat LAN with the gateway + sensors reachable. Record results in the PR / session notes.

- [ ] **Flood shutoff (local):** trigger the flood sensor (bridge the probes). App open on LAN →
      valve closes within ~20 s; Event Sentry logs it.
- [ ] **Flood shutoff (cloud fallback):** with the app closed, replay/trigger flood →
      `flood.alarm` GET hits the worker → `shutoff:{ok:true}` → valve closes. (⚠️ this physically
      closes the valve.)
- [ ] **No false shutoff:** `flood.alarm_off` (dried out) does **not** re-close / loop; telemetry
      (`voltmeter.measurement`) does **not** trigger shutoff or push.
- [ ] **Valve open/close** from the app (local-first, then cloud) works; optimistic state lock
      behaves over the ~15 s RF lag.
- [ ] **Push notifications:** a real flood produces an FCM push to a signed-in phone (gated on the
      worker SA having the FCM role — open-tasks ACTIVE Break #2).
- [ ] **Telemetry remote:** off-LAN, the battery/voltage widget shows the worker-cached value.
- [ ] **Leave the valve in the intended state** (CLOSED for an unattended boat) when done.
