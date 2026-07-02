# Use cases — who Guardian protects, and how

Boat & RV Guardian is one system, but it earns its keep differently depending on how you use your
boat or RV. This page walks through the six situations we designed for: what typically goes wrong,
which shipped feature covers it, and what tier (if any) unlocks it. Shorter versions live on the
website at [boatrvguardian.com/use-cases](https://boatrvguardian.com/use-cases/).

Two things to keep in mind throughout:

- **The safety model is the valve limit, not the automation.** The LinkTap valve only ever opens
  with a volume/duration limit — every open command carries one — so a burst hose ends with a
  bounded amount of water, never an unbounded flood. The flood-sensor auto-shutoff (local while the
  app is open on any tier; cloud fallback with the app closed on Basic+) closes the valve *sooner*.
  It's the fast layer on top of the hard limit, not the only line of defense.
- **Plans attach to the vehicle, not the person.** The owner subscribes once and everyone the
  vehicle is shared with inherits its features. Everything local is free on every tier, forever.
  Hosted plans: Free / Basic ($3/mo · $12/yr) / Premium ($5/mo · $30/yr) — see
  [pricing](https://boatrvguardian.com/pricing) and the [README](../README.md#what-it-costs).

Hardware referenced below is on [Supported Devices](https://boatrvguardian.com/devices); a typical
full build is ~$265–290, one-time. The project is **pre-alpha** — honest rough edges apply.

---

## 1. Boat in a slip

*Web version: [boatrvguardian.com/use-cases/boat-in-a-slip](https://boatrvguardian.com/use-cases/boat-in-a-slip)*

You keep the boat at a marina with a city-water hookup and shore power, and visit on weekends. The
rest of the week it sits — plugged in, pressurized, and unattended.

**What goes wrong:**

- A hose or fitting lets go on the pressurized city-water line — unlimited water, straight into the
  boat.
- The bilge fills faster than the pump can keep up (or the pump's battery has died).
- The shore-power pedestal trips and nobody notices; the battery charger stops, the fridge thaws.
- The house bank drifts down over the week until the bilge pump can't run.

**How Guardian covers it:**

- The LinkTap valve at the dock spigot meters flow and opens **only** with a volume/duration limit
  — a burst line ends with a bounded amount of water even if nothing else works (any tier, free).
- A Shelly Flood Gen4 in the bilge triggers the auto-shutoff to close the valve sooner: locally
  while the app is open, and via the cloud with the app closed on **Basic+** (measured ~16 s from
  alarm to valve-close command).
- A Shelly PM Mini Gen3 watches shore power; a Shelly Plus Uni watches the house bank. Away push
  notifications on **Basic+** mean you hear about a tripped pedestal Monday morning, not Friday
  night.
- Remote monitoring from home: manual refresh on Free (throttled ~3 min), automatic ~5-min
  freshness on **Basic**, ~1-min on **Premium**.

**Recommended:** LinkTap valve + Gateway, Flood Gen4 in the bilge, PM Mini on shore power, Plus Uni
on the house bank (~$265–290) · **Basic** for the cloud shutoff fallback and away push.

## 2. Liveaboard

*Web version: [boatrvguardian.com/use-cases/liveaboard](https://boatrvguardian.com/use-cases/liveaboard)*

The boat is home. You're aboard most nights — but you still go to work, visit family, and haul out
for maintenance. Aboard, you want instant local visibility; away, you want the same protection as a
slip boat.

**What goes wrong:**

- A pressurized line fails while you're at work — hours of unattended flow.
- Water heater or plumbing drips go unnoticed behind panels until something is soaked.
- The battery bank quietly loses capacity and you find out during an outage.
- You're away for a week and have no idea what state the boat is in.

**How Guardian covers it:**

- Local-first: aboard, the app talks directly to the gateway and sensors over the boat's LAN — no
  internet, no account, no cost. The in-app flood watchdog works for everyone while the app is open.
- Flood sensors under the water heater, head, and galley sink catch drips and failures early; the
  valve's open-limit bounds the worst case regardless of tier.
- The Shelly Plus Uni tracks the bank with chemistry presets (Flooded/AGM/Gel/LiFePO₄) and a
  calibration offset, and history shows the trend — on-device always, hosted ~1 month on **Basic**,
  ~3 years + CSV export on **Premium**.
- When you're off the boat, **Basic+** adds push alerts and the cloud shutoff fallback; **Premium**
  adds SMS escalation for the alerts that must not be missed.

**Recommended:** full build (valve + Gateway, 2–3 Flood Gen4, Plus Uni, PM Mini) · **Basic**, or
**Premium** if you travel for weeks at a time and want SMS + longer history.

## 3. Seasonal storage & winterization

*Web version: [boatrvguardian.com/use-cases/seasonal-storage](https://boatrvguardian.com/use-cases/seasonal-storage)*

The boat is on the hard (or the camper is winterized in a lot) from October to April. Water is off
— now the risks are electrical, and slow.

**What goes wrong:**

- Batteries self-discharge or a trickle charger fails; in spring the bank is ruined.
- Storage-yard power drops and nobody tells you.
- Rain, snow melt, or a failed cover puts water where it shouldn't be — for months.
- A hard freeze catches un-winterized plumbing. (Temperature monitoring is **coming soon** — today
  Guardian does not watch temperature, so winterize properly and don't count on an alert.)

**How Guardian covers it:**

- The Shelly Plus Uni reports bank voltage all winter; with **Basic**, automatic remote telemetry
  (~5-min freshness) plus away push means a failing charger is a notification, not a spring
  surprise. On Free you can still check manually whenever you think of it.
- The Shelly PM Mini flags shore-power loss at the storage yard the moment it happens (**Basic+**
  for the push; the event is visible on refresh on Free).
- A Flood Gen4 in the bilge or low point catches water intrusion under the cover. It's
  battery-powered and deep-sleeps, so it lasts the season and pushes events instantly.
- Hosted history (~1 month **Basic**, ~3 years **Premium**) gives you the voltage curve across the
  whole layup — useful for deciding when a bank is due for replacement.

**Recommended:** Plus Uni + PM Mini + one Flood Gen4 (~$100 without the valve) · **Basic** for the
winter, since the whole point is being told while you're not there.

## 4. RV between trips

*Web version: [boatrvguardian.com/use-cases/rv-between-trips](https://boatrvguardian.com/use-cases/rv-between-trips)*

The rig lives in the driveway or a storage lot between weekend trips. It's plugged in (or not), and
mostly you just want to know it's ready to go.

**What goes wrong:**

- The house battery is dead when you arrive Friday night, and the trip starts with a jump box.
- A water line, water heater, or pump fitting weeps inside a cabinet for weeks.
  ([Hose-burst protection diagram](images/hose_burst_protection.png) shows the water-side setup;
  see also the [RV setup diagram](images/rv_setup_diagram.png).)
- Storage-lot power fails and the battery tender stops tending.
- You left the water pump on, or the city-water connection pressurized.

**How Guardian covers it:**

- The Plus Uni tells you the house bank's real state before you drive over — automatic on
  **Basic+**, manual refresh on Free.
- If the rig stays connected to a spigot, the LinkTap valve makes that connection safe: every open
  is volume/duration-limited, and flood sensors close it early (locally with the app open; cloud
  fallback on **Basic+**).
- A Flood Gen4 under the wet bay or water heater catches slow leaks while the rig sits.
- The PM Mini confirms the lot's pedestal is actually delivering power to your charger.

**Recommended:** Plus Uni + Flood Gen4, add the valve + Gateway if you store connected to water ·
Free is workable if you check the app; **Basic** if you'd rather be told.

## 5. Full-time RV & snowbirds

*Web version: [boatrvguardian.com/use-cases/full-time-rv](https://boatrvguardian.com/use-cases/full-time-rv)*

The rig is home year-round, or it's the winter home you leave behind for the summer (or vice
versa). Long occupancy plus long absences — you need both the liveaboard and the storage story.

**What goes wrong:**

- Living aboard: plumbing failures on park water hookups with real pressure behind them.
- Leaving it for a season: everything in the storage scenario — dying batteries, dead pedestals,
  quiet leaks — for months at a time, possibly thousands of miles away.
- Boondocking/off-grid: battery state is everything, and guessing is expensive.
- Alerts you don't see. When the rig is your house, a missed notification matters more.

**How Guardian covers it:**

- On a park hookup, the valve's open-limit turns "unlimited park water" into a bounded risk, and
  the flood-shutoff layer reacts in seconds (local any tier; cloud on **Basic+**).
- Off-grid, battery monitoring with chemistry presets covers 12/24 V banks; local mode costs
  nothing and needs no internet.
- Leaving for the season, **Premium** earns its $5/mo: ~1-min remote freshness, SMS escalation on
  top of push, ~3 years of history with CSV export, and priority support. Voice-call alerts are on
  the roadmap (**coming soon**), as are Home Assistant/MQTT/IFTTT integrations.
- Multi-vehicle support means the truck camper and the fifth wheel are separate vehicles under one
  account, each with its own plan.

**Recommended:** full build, plus extra Flood Gen4 sensors for each wet zone · **Premium** while
the rig is out of reach; you can run a cheaper tier when you're living in it.

## 6. Shared boats and small fleets

*Web version: [boatrvguardian.com/use-cases/shared-and-fleet](https://boatrvguardian.com/use-cases/shared-and-fleet)*

A family boat with three sets of keys, a partnership, a sailing club, or a small charter/rental
operation. The problem isn't just the boat — it's coordinating the humans.

**What goes wrong:**

- Nobody is sure who was aboard last, or whether the water was left on.
- A renter or guest needs to see the boat's state without being able to change anything.
- Staff need control; owners need oversight; nobody wants to share one login.
- An incident happens and there's no record of what led up to it.

**How Guardian covers it:**

- Per-vehicle sharing with three roles, on **every tier**: **Full Admin** (everything),
  **Monitor & Control** (view + operate), and **Monitor** (view-only — right for renters and
  guests). Invites go to an email address and are accepted in the app; each person uses their own
  account.
- The plan follows the vehicle: one subscription per boat, and every shared user inherits its
  features. A club pays once per boat, not per member. Ownership can be transferred when a boat is
  sold.
- The event log and history answer "what happened and when": on-device always, hosted ~1 month on
  **Basic**, ~3 years + CSV export on **Premium** — the CSV is handy for incident reports.
- The same safety model protects the boat from whoever used it last: every valve open is
  volume/duration-limited, and the cloud flood shutoff (**Basic+**) works no matter whose app is
  closed.

**Recommended:** full build per boat · **Basic** per boat minimum for a fleet, **Premium** for
charter boats where SMS escalation and exportable history matter.

---

## Where to go next

- [README](../README.md) — feature overview, pricing table, platforms.
- [Supported Devices](https://boatrvguardian.com/devices) · [Getting Started](https://boatrvguardian.com/getting-started) · [Pricing](https://boatrvguardian.com/pricing)
- [SELF_HOST.md](SELF_HOST.md) + [brvg-cloud-server](https://github.com/Boat-RV-Guardian/brvg-cloud-server)
  — run your own relay server instead of the hosted cloud.
- [ARCHITECTURE.md](../ARCHITECTURE.md) — how the local and cloud paths actually work.
