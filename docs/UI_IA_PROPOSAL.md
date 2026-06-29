# UI / Information-Architecture proposal (open-tasks Task 16)

**Status:** v1 reviewed by owner 2026-06-29 — **approved to build in full.** Owner decisions folded in
below (see §0). Created 2026-06-29.

## 0. Owner decisions (2026-06-29)

- **Valve/flood = treat like any other sensor** — neither more nor less important. (This corrects v1's
  "least-used, don't give it prime real estate" framing. The *safety* model — valve self-limits, never
  weaken the open-limit — is unrelated and unchanged.)
- **Mobile nav:** bottom tab bar (Overview / Systems / Alerts / Settings). ✅
- **Valve placement:** a peer device under **Systems → Water**, not its own special section. ✅
- **Alerts v1:** event history + current-issues banner **and** push-channel management (move SMS/push
  device management here from Account). ✅
- **Account vs Settings cut:** identity + billing + mode in **Account**; config + devices + sharing in
  **Settings**. ✅
- **Naming:** Overview / Systems / Alerts / Settings accepted. ✅
- **Sequencing:** build the whole migration (all 6 steps).

The owner's ask (2026-06-28): *step back and rethink the app's UI/layout holistically — navigation,
information hierarchy, onboarding, settings density, the dashboard/sensor pages — rather than continuing
to bolt panels on. Produce a proposed layout/IA before refactoring.*

This document inventories the current IA, names the structural problems, proposes a target IA, and lays
out an **incremental, gate-green migration** that leverages the Task 3 component extraction (the render
layer is already movable). It changes nothing until we agree on a direction.

---

## 1. Constraints & priorities (what the IA must respect)

From CLAUDE.md / AGENTS.md / the owner:

- **Every sensor is a peer.** Monitoring (remote view / history / alerts) is the product, and the
  **valve/flood is treated like any other sensor** — neither privileged nor de-prioritized (owner,
  2026-06-29). The valve self-limits and the flood automation is convenience, not the safety net, but
  that's a *safety* fact, not a UI-prominence one.
- **Per-vehicle "Plex" model.** Entitlements, role, tier, history all attach to the **active vehicle**.
  The active vehicle is the most important piece of global context and should be visible/switchable
  everywhere.
- **Cloud vs local vs self-host modes** are device-wide and mutually exclusive (no hybrid). The IA must
  make the current mode legible and the switch discoverable (Task 15).
- **Tiers (Free/Basic/Premium)** gate features. Gated UI should read as "upgrade to unlock," not as
  broken/missing.
- **Don't break what works.** Migrate in small, behavior-preserving, gate-green steps (the AGENTS.md
  contract). The panels are already extracted, so this is mostly *re-parenting* existing components.
- **Native-first** (Tauri desktop + Capacitor mobile). Navigation must work on a phone screen.

---

## 2. Current IA (as built, v1.0.46)

**Top-level navigation** — a single flat row of 6 buttons in the `App.tsx` header:

```
[ 📊 Dashboard ] [ Fresh Water ] [ High Water ] [ Batteries ] [ Shore Power ] [ ⚙ Settings ]
```

Plus a hidden **Account** view (`AppView='account'`) reachable only via the Plan badge's "Upgrade"
(`navigate_view`) — it is not in the nav.

| View | Content |
|------|---------|
| **Dashboard** (`Home`) | Vessel name + one card per category (fresh water, high water, batteries, shore power), each linking into its page. |
| **Fresh Water** | The `Dashboard` page = `LinkTapWidget`(s) — i.e. **the water valve / LinkTap control** (kept always-mounted to preserve polling). |
| **High Water** | `Sensors category="flood"` → flood `ShellyWidget`s. |
| **Batteries** | `Sensors category="batteries"` → battery-voltage `ShellyWidget`s. |
| **Shore Power** | `Sensors category="shore_power"` → shore `ShellyWidget`s. |
| **Settings** | Tabs: **General** (Vehicles, Account, Local Server, Device Preferences, Notifications, Subscription), **Devices** (Add / Configuration / Advanced / LinkTap Auth), **Sharing** (Friends), **Updates**. |
| **Account** (hidden) | Plan + feature list, account basics, usage-vs-plan, trial status, CSV export, SMS prefs, API tokens, delete account. |

---

## 3. Problems

1. **Flat 6-tab nav doesn't scale.** Dashboard, four sensor categories, and Settings sit at one level.
   Every new area = another top-level tab (already overflowing on a phone) or another panel bolted into
   Settings. There's no "room to grow."
2. **Uneven prominence.** "Fresh Water" (the valve) gets its own primary tab while the read-only sensors
   are split across 3 separate category tabs — inconsistent weighting for what should be peer systems.
3. **Four sensor categories as four top-level tabs.** They're conceptually one thing — "systems /
   sensors." The Dashboard already summarizes them; the split triples the nav cost of browsing.
4. **Two overlapping "account" surfaces.** Sign-in/out + sync toggles live in *Settings → General →
   Account*; plan/billing/usage/delete live in the separate *Account portal*. Users can't predict which
   holds what, and we maintain account UI in two places.
5. **Settings is a junk drawer.** The General tab alone holds Vehicles + Account + Local Server + Device
   Preferences + Notifications + Subscription — six unrelated concerns. This is the "bolting panels on"
   the owner called out.
6. **The active vehicle is buried.** For a per-vehicle product, switching vehicle requires *Settings →
   General → Vehicles*. It should be a persistent, top-level control (think Plex's server picker).
7. **No first-class Alerts surface.** Notification *config* is buried in Settings; there's a per-device
   Event Sentry Log but no app-level "what happened / what's wrong now" view — yet alerts are a core,
   high-use part of the product.
8. **Mode (cloud/local/self-host) isn't legible** at a glance; it's inferred from Settings → Account.

---

## 4. Proposed target IA

### 4.1 Navigation model

Replace the flat 6-tab row with **a persistent top bar (global context) + a 4-item primary nav**:

```
┌───────────────────────────────────────────────────────────────┐
│  🛟 Guardian   [ ▾ Serenity (Boat) · Premium ]      [ 👤 ]     │  ← global bar
├───────────────────────────────────────────────────────────────┤
│   📊 Overview      🛰 Systems      🔔 Alerts      ⚙ Settings    │  ← primary nav (4)
└───────────────────────────────────────────────────────────────┘
```

- **Vehicle switcher** (`▾ Serenity (Boat) · Premium`) — moves the buried picker into global context;
  shows the active vehicle, its type, and its tier. This is the single most important piece of state.
- **Account menu** (`👤`) — one home for identity: profile, plan/billing, mode (cloud/local/self-host),
  sign in/out, delete account. Collapses the two overlapping account surfaces into one.
- **Primary nav = 4 destinations** (phone-friendly; room to grow):
  - **Overview** — the dashboard (status at a glance, the most-used screen).
  - **Systems** — *one* destination for all sensors **and** the valve, with sub-sections for Water,
    Power, and Flood (see 4.2). Collapses the 4 category tabs + Fresh Water into one.
  - **Alerts** — a new first-class surface: current conditions + recent events (history of pushes /
    flood / battery / shore-power events), with notification preferences one tap away.
  - **Settings** — device/config/sharing/updates only (account & billing move out to the Account menu).

> On mobile this maps cleanly to a bottom tab bar (Overview / Systems / Alerts / Settings) with the
> vehicle switcher + account in the top bar.

### 4.2 "Systems" — consolidate the sensor/valve pages

One screen, section-scoped (or sub-tabbed), reusing the existing widgets unchanged:

- **Water** — fresh-water level/usage **and** the valve control (`LinkTapWidget`), as peer devices.
  Grouping the valve here (instead of a top-level "Fresh Water" tab) gives it the same weight as any
  other sensor (owner: treat it like any other sensor). The `LinkTapWidget` stays mounted (display
  toggle) so its poll/command state machine isn't disrupted.
- **Power** — batteries + shore power (the two voltage categories, already similar `ShellyWidget`s).
- **Flood / High Water** — the flood sensors.

Rationale: monitoring becomes one coherent area; the valve is present but not privileged; the Dashboard
remains the fast path and deep-links into the relevant Systems section.

### 4.3 "Account" menu — collapse the duplication

Everything identity/billing in one place (the existing **Account portal** is already most of this —
promote it from a hidden view to the `👤` menu, and **move** Settings→General→Account's sign-in/out +
sync toggles into it):

- Profile (display name [done], email, password/SSO).
- **Mode**: Cloud / Local-only / Self-host — current mode + the switch (Task 15 lives here naturally).
- Plan & billing (plan, trial, usage-vs-plan, upgrade, invoices later).
- Data & privacy (CSV export, delete account).
- Premium: SMS/voice prefs, API tokens.

### 4.4 "Settings" — slim to true configuration

After Account moves out, Settings is just: **Devices** (add/config/advanced/LinkTap auth), **Sharing**
(Friends), **Updates**, **Device preferences** (tz/units/notification toggles — local-only), and the
**self-host server** fields. No identity, no billing.

### 4.5 "Alerts" — new, but cheap

Seed it from data that already exists: the per-device Event Sentry Log + worker-cached `sensorState`
(last event/freshness). v1 = a merged, vehicle-scoped event list + a "current issues" banner + a link to
notification preferences. No new backend required for v1.

---

## 5. Why this fits the product

- **Even weighting** (owner priority): the valve is a peer device under Systems → Water, not a
  privileged primary tab.
- **Elevates monitoring + alerts** (the high-use core) to first-class destinations.
- **Makes the active vehicle global** — matches the per-vehicle "Plex" model.
- **One account home** — ends the Settings/Account duplication and gives mode-switching a natural seat.
- **Scales** — 4 primary destinations with internal sections, instead of an ever-growing tab row.

---

## 6. Incremental migration (each step gate-green, behavior-preserving)

The panels/widgets are already extracted (Task 3), so most steps are **re-parenting**, not rewrites.

1. **Global bar — vehicle switcher.** Surface the existing `switchVehicle` picker in the header. Pure
   re-parent of logic already in Settings → Vehicles. (Low risk; high daily value.)
2. **Account menu.** Promote the Account portal to the `👤` menu; move Settings→General→Account's
   sign-in/out + sync toggles into it; leave a redirect stub. Removes one duplication.
3. **Consolidate Systems.** Introduce a `Systems` shell with Water/Power/Flood sections that render the
   existing `LinkTapWidget` + `Sensors` components unchanged; collapse the 4 nav tabs to one. (View-layer
   only — the widgets don't change.)
4. **Primary nav → 4 items.** Swap the 6-button row for Overview/Systems/Alerts/Settings (+ deep links
   from Dashboard cards into Systems sections).
5. **Alerts v1.** Merge the per-device event logs + `sensorState` into one vehicle-scoped view; link
   notification prefs. Pure UI over existing data.
6. **Slim Settings.** Remove the migrated Account/billing panels; keep Devices/Sharing/Updates/Prefs.

Each step ships behind the four gates (`tsc -b`, dashboard tests + RTL, `vite build`) and a native
click-through (it's a navigation change → verify in `npm run tauri dev`). Steps 1–2 deliver most of the
daily-use win and are the safest; 3–6 can follow as appetite allows.

---

## 7. Open questions for the owner — ✅ RESOLVED 2026-06-29 (answers in §0)

1. **Mobile nav:** bottom tab bar (Overview/Systems/Alerts/Settings) — agree?
2. **Valve placement:** under **Systems → Water** (proposed), or does it deserve its own section given
   it's the only *control* (vs. read-only sensors)?
3. **Alerts scope for v1:** event history + current-issues banner only, or also push-channel management
   (move SMS/push device management here from Account)?
4. **Account vs Settings line:** is "identity + billing + mode" in Account, "config + devices + sharing"
   in Settings the right cut?
5. **Naming:** "Systems" vs "Sensors" vs "Monitor"? "Overview" vs "Dashboard"?
6. **Sequencing:** do steps 1–2 (vehicle switcher + account consolidation) first as a quick win, or
   design the whole shell before moving anything?
