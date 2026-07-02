# AGENTS.md — working contract for agents (and humans) on this repo

Created 2026-06-25 (open-tasks Task 10). This is the **how we work** companion to
[CLAUDE.md](CLAUDE.md) (which holds the domain facts). Read both. The guiding principle, in the
owner's words: **as rapid development accelerates, don't break anything that works.**

This app actuates **physical water valves on unattended vehicles**, so be conservative and verifiable.
But know the actual safety model (owner, 2026-06-25): **the LinkTap valve is the primary safeguard —
it should only be sent commands that open the valve with a volume/duration limit, so it physically can't run long enough to sink the
boat.** The flood→shutoff automation closes it *sooner* than that limit; it's a convenience, not the
last line of defense. So: don't introduce spurious valve behavior, but don't over-dramatize the
flood-automation stakes either — a missed cloud shutoff means a bounded amount of water, not a sunk
boat. **Never weaken the valve's open-limit, though** — that limit is the real safety net.

## The contract

1. **Small, reviewable increments.** Prefer a sequence of behavior-preserving steps over one big
   change. The Task 3 `LinkTapWidget` refactor is the model: each increment was green on
   `tsc` + tests + a real build before the next. One logical change per commit.

2. **No feature without a test.** New logic ships with unit tests. Bug fixes ship with a test that
   fails before the fix. UI-only/style tweaks are exempt. See [docs/TESTING.md](docs/TESTING.md).

3. **Extract logic to pure functions, then test it.** If you find a rule inlined in a component or
   the worker `fetch` handler, pull it into a pure util/hook and cover it. This is how `events.ts`
   and the LinkTap utils exist.

4. **Every gate green before "done."** `tsc -b`, `npm test` (dashboard + worker), and
   `wrangler deploy --dry-run` (worker) must pass. Run a real `npm run build` for non-trivial
   dashboard changes. A red gate means the change isn't finished — don't mark it complete, don't
   merge it. (Note: raw `tsc` mis-flags the worker; its gate is the wrangler dry-run.)

5. **Server-side enforcement over client-only.** Client gating (role, entitlement) is advisory UX.
   Anything that protects a resource or a paid feature must also be enforced where the user can't
   bypass it (the worker). The monitor-role gap (CLAUDE.md) is the cautionary tale.

6. **Protect valve behavior; the valve's open-limit is the real safety net.** Don't change
   `events.ts` flood classification, the worker shutoff path, or the poll/command state machine
   without (a) a regression test and (b) a note that it needs the hardware smoke test
   (docs/TESTING.md). Redundant/idempotent closes are fine. A missed flood-shutoff is bounded (the
   valve self-limits), so it's not catastrophic — but **never remove or weaken the volume/duration
   limit applied when opening the valve**: that limit, not the flood automation, is what prevents a
   sunk boat.

7. **Respect the documented invariants.** Especially: **time policy** — store UTC
   (`Date.now()`/ISO), display via `dashboard/src/utils/time.ts` in `lt_tz`; never call
   `toLocale*` directly. **Entitlements are per-vehicle** (not per-user). Prefer gating via the
   entitlement layer over ad-hoc checks.

8. **Defer hardware-risky work honestly.** Some logic (RF actuation timing, sleeping sensors) can't
   be verified by `tsc`/tests/build. If a change touches it, say so and leave it for a session that
   can smoke-test against a live gateway — don't claim it verified.

9. **Keep files within a size budget.** Oversized files (`Settings.tsx`, `LinkTapWidget.tsx`) are an
   active refactor target (Task 3). Don't grow them; extract into `pages/settings/*`,
   `hooks/*`, `utils/*`.

10. **Version-bump discipline.** A release touches **7 files** (CLAUDE.md lists them) — keep them in
    sync: `dashboard/package.json`, `dashboard/src-tauri/{tauri.conf.json,Cargo.toml,Cargo.lock}`,
    `APP_VERSION` in `Settings.tsx` + `LinkTapWidget.tsx`, `dashboard/android/app/build.gradle`.
    Release = bump → commit → `git tag vX.Y.Z` → push main + tag.

11. **User-facing URLs use `boatrvguardian.com` subdomains** (Task 11): `api.` worker, `app.` web,
    `admin.` admin. Don't hardcode `*.workers.dev` / `*.web.app` into anything a user sees.

12. **Commit messages** are conventional (`feat`/`fix`/`docs`/`refactor`/`chore(release)`), explain
    the *why*, and end with the `Co-Authored-By` trailer. Keep `open-tasks.md` in sync with reality
    (check items off, record decisions, delete obsolete tasks).

## Before you start / before you finish

- **Start:** read CLAUDE.md + the top of open-tasks.md (the 🚨 ACTIVE section). Pull latest.
- **Finish:** gates green → update open-tasks.md → commit + push (non-destructive ops don't need
  approval) → note anything left for a hardware smoke test.
