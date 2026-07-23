# 🛟 Boat & RV Guardian

**Free, open-source monitoring and protection for boats and RVs — even when you're miles away.**

A dead battery stops your bilge pump. A burst line on an unlimited city-water hookup floods a cabin.
A tripped shore-power pedestal quietly thaws your fridge. These failures are almost always *quiet* —
they happen while you're asleep, at work, or three states away.

Boat & RV Guardian watches for them and acts. It turns affordable, off-the-shelf smart-home hardware
— **LinkTap** valves and **Shelly** sensors — into a purpose-built safety system for vessels and
rigs. The app and the self-hostable server are free and open-source (GPL-3.0); everything works
locally on your vehicle's network at no cost, and optional hosted plans add remote access, alerts,
and history.

> **Status: pre-alpha.** The core system works, but expect rough edges — and don't make it your
> only line of defense yet.

<p align="center">
  <a href="https://boatrvguardian.com"><b>🌐 Website</b></a> &nbsp;·&nbsp;
  <a href="https://app.boatrvguardian.com"><b>🚀 Launch the Web App</b></a> &nbsp;·&nbsp;
  <a href="https://boatrvguardian.com/devices"><b>🛠️ Supported Devices</b></a> &nbsp;·&nbsp;
  <a href="https://boatrvguardian.com/pricing"><b>💲 Pricing</b></a> &nbsp;·&nbsp;
  <a href="https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/releases"><b>📦 Download</b></a>
</p>

> Built by boaters and RVers, for boaters and RVers. Free core app, no vendor lock-in, no data held
> hostage.

---

## Why it exists

Marine and RV monitoring has long meant proprietary hardware at marine prices, walled-garden apps,
and a monthly bill just to keep watching your own boat. Meanwhile, the home-automation world has
cheap, reliable, well-documented sensors that do the exact same jobs. Guardian bridges that gap —
and gives the software away, so cost is never the reason a vessel or rig goes unprotected.

## Who it's for

Anyone who leaves a vessel or rig unattended and would rather get a phone alert than a repair bill:

- **Boat in a slip** — city-water hookups, bilge and battery anxiety, storm season.
- **Liveaboards** — aboard most nights, but not all of them.
- **Seasonal storage & winterization** — months on the hard or in a lot, batteries slowly dying.
- **RV between trips** — parked in a driveway or storage lot between weekends.
- **Full-time RVers & snowbirds** — the rig is home, and sometimes it's left behind.
- **Shared boats & small fleets** — families, partnerships, clubs, and charter operations.

Each scenario is worked through in detail in [docs/USE_CASES.md](docs/USE_CASES.md) and on the
website at [boatrvguardian.com/use-cases](https://boatrvguardian.com/use-cases/).

## What it does

**Watch.** Real-time monitoring of the systems that fail quietly: water flow through the valve's
built-in meter, flood/high-water sensors in the bilge or under sinks, 12/24 V battery banks (with
chemistry presets for Flooded/AGM/Gel/LiFePO₄ and a calibration offset), AC shore power, and
temperature/humidity for freeze and mold warnings. Location (GPS via the cellular gateway) and
motion/tilt sensing round out the roadmap. Multi-vehicle support is built in.

**Act.** The LinkTap smart valve controls your water supply — and it **only ever opens with a
volume/duration limit**. Every open command carries one, so a burst hose ends with a bounded amount
of water, not an unbounded flood. That physical limit is the primary safeguard. On top of it, flood
sensors trigger an automatic shutoff that closes the valve *sooner*: locally while the app is open
(any tier), and via a cloud fallback even with the app closed (Basic+, measured ~16 s from alarm to
valve-close command).

**Know.** Alerts where you are: in-app alarms while you're aboard on the local network, push
notifications to your phone when you're away (Basic+), and SMS escalation for the alerts that must
not be missed (Premium).

**Share.** Per-vehicle sharing with three roles — Full Admin, Monitor & Control, and Monitor
(view-only). Plans attach to the vehicle, so everyone it's shared with inherits its features.
Ownership can be transferred.

**Remember.** Usage and event history always lives on-device, free. Hosted plans add cloud history
you can see from anywhere — about a month on Basic, about three years plus CSV export on Premium
(long-term data is downsampled to hourly aggregates).

## Supported hardware

| Role | Device | Notes |
| --- | --- | --- |
| Water shutoff + flow metering | **LinkTap G2S smart valve** (G1S/G4S also work) | Wireless valve with built-in flow meter; ~$85–100 |
| Valve bridge | **LinkTap Gateway** (GW-01/02) | Zigbee-to-Wi-Fi bridge with a local HTTP API; valve commands take ~15 s over RF |
| Flood / high water | **Shelly Flood Gen4** | Battery-powered, deep-sleeps, pushes events instantly via webhook (~$30) |
| Battery voltage | **Shelly Plus Uni** | 0–30 V voltmeter input for 12/24 V banks; chemistry presets + calibration in-app |
| Shore power (AC) | **Shelly PM Mini Gen3** | Detects shore-power loss, tracks AC consumption (~$25) |
| Temperature / humidity | **Shelly Plus H&T** (or a DS18B20 probe on the Plus Uni) | Cabin/engine/fridge temperature + humidity for freeze and mold warnings (~$30, or ~$5 for the probe) |
| Location (GPS) | via your **cellular gateway** | Most LTE gateways (GL.iNet X-series, Teltonika RUT) include GPS — location + geofence anti-theft with no extra hardware |
| Motion / tilt (accelerometer) | — | **Roadmap** — anchor-drag / impact / theft alerts; targeting low-cost battery sensors |

Shelly devices provision over Bluetooth from the Android app (recommended), or via their Wi-Fi AP /
manual IP from any platform. Full list with buy links:
[Supported Devices](https://boatrvguardian.com/devices). To keep an unattended rig online cheaply,
see the [Connectivity & Gateways guide](https://boatrvguardian.com/devices/connectivity) — the
sensors sip data, so a cheap SIM or marina Wi-Fi is usually all you need (no Starlink required).

## Three ways to run it

A vehicle's devices run in exactly **one** of these modes — they're never mixed on one device:

1. **Hosted cloud** (default — what the plans are for): sign in and your per-vehicle settings sync
   across all your devices, sharing works, and you get the remote features of your tier.
2. **Self-hosted server**: run your own relay for sensor webhooks, push alerts, flood auto-shutoff,
   and history — a Docker one-liner on a Raspberry Pi or any VPS. See
   [brvg-cloud-server](https://github.com/Boat-RV-Guardian/brvg-cloud-server) and
   [docs/SELF_HOST.md](docs/SELF_HOST.md). Note: a self-hosted server does **not** sync
   configuration between devices — each device's settings are entered on that device. Point the app
   at it under Settings → Vehicles → Advanced → Custom Cloud Server URL.
3. **Local-only** (no account): nothing leaves the device. You can switch to cloud later — the app
   migrates local vehicles into a new cloud account.

## How it works

When you're on the same network as your hardware, the app uses a **local connection** for fast,
internet-free control. When you're away, Shelly sensors fire webhooks to the cloud server
(api.boatrvguardian.com — a Cloudflare Worker — or your self-hosted instance), which caches sensor
state, alerts you, and on a flood event can close the valve through LinkTap's cloud.
Battery-powered sensors are event-driven — they're never polled.

```
LOCAL (aboard)     Phone / Laptop  <->  LinkTap Gateway  <->  Smart Valve
                   Direct, low-latency control. No internet required.

CLOUD (away)       Flood Sensor  ->  Cloud Server (hosted or self-hosted)  ->  Push / SMS Alert
                                                                            +  Remote Valve Shutoff
```

## What it costs

### Hardware (one-time, yours)

| System | Hardware | Est. cost |
| --- | --- | --- |
| City water control | LinkTap valve + Gateway | ~$135–160 |
| Flood / high water | Shelly Flood Gen4 | ~$30 each |
| 12V battery monitoring | Shelly Plus Uni + fused harness + enclosure | ~$45 |
| Shore power | Shelly PM Mini Gen3 | ~$25 |

A typical full build runs **~$265–290**. Estimates only — prices vary by region. Marine-brand
monitoring systems typically run $500–1,500+ plus subscriptions.

### Software

The app and the self-hosted server are **free forever** (GPL-3.0). Local monitoring, local control,
and the local flood shutoff cost nothing and never will. Hosted cloud plans are optional and
**per-vehicle** — the owner subscribes, and everyone the vehicle is shared with inherits its
features:

| | Free $0 | Basic $3/mo · $12/yr | Premium $5/mo · $30/yr |
| --- | --- | --- | --- |
| Local monitoring, control, local flood shutoff (app open) | ✓ | ✓ | ✓ |
| Cloud settings sync + vehicle sharing | ✓ | ✓ | ✓ |
| Remote monitoring | Manual refresh (throttled ~3 min) | Automatic, ~5-min freshness | Automatic, ~1-min freshness |
| Remote control (off-LAN) | — | ✓ | ✓ |
| Away push notifications (app closed) | — | ✓ | ✓ |
| Cloud flood-shutoff fallback (app closed) | — | ✓ | ✓ |
| Hosted history | On-device only | ~1 month | ~3 years + CSV export |
| SMS alert escalation | — | — | ✓ |
| Priority support | — | — | ✓ |
| Cloud automation (timers/schedules/rules) | — | *Coming soon* | *Coming soon* |
| Voice-call alerts | — | — | *Coming soon* |
| Integrations (Home Assistant, MQTT, IFTTT, webhooks) | — | — | *Coming soon* |

Every vehicle can opt into **one month of Basic free** (one trial per vehicle, started from the
app's Account view; it drops back to Free automatically). Full details:
[boatrvguardian.com/pricing](https://boatrvguardian.com/pricing). The project is pre-alpha — plans
are activated through the [account portal](https://app.boatrvguardian.com/account).

## Platforms

- **Web** — [app.boatrvguardian.com](https://app.boatrvguardian.com), runs in any modern browser.
- **macOS & Windows** — native desktop apps (Tauri), in
  [Releases](https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/releases).
- **Android** — native app (Capacitor), signed APK in Releases.
- **iOS** — native app is on the roadmap; the web app works well on iPhone/iPad today.

New here? Pick hardware on [Supported Devices](https://boatrvguardian.com/devices), get the app,
then follow the [Quick Start](https://boatrvguardian.com/docs/quick-start). Stuck? Head to
[Support](https://boatrvguardian.com/support).

---

## For developers

This repository holds two domains — the app and its webhook backend:

| Path | What it is |
| --- | --- |
| [`/dashboard`](dashboard) | The core app (React + Vite + TypeScript), packaged for Web, Desktop (Tauri), and Mobile (Capacitor). |
| [`/worker`](worker) | Cloudflare Worker that receives Shelly webhooks and triggers LinkTap shutoffs + push alerts. |

**Stack:** React · Vite · TypeScript · Tauri · Capacitor · Firebase (Auth + Firestore) · Cloudflare
Workers.

```bash
# Dashboard app (web)
cd dashboard && npm install && npm run dev

# Dashboard app (desktop)
cd dashboard && npm run tauri dev

# Gates — green before "done" (see AGENTS.md):
cd dashboard && npx tsc -b && npm test && npm run build
cd worker && npm test && npx wrangler deploy --dry-run
```

Deeper docs: the [docs index](docs/README.md) · [`ARCHITECTURE.md`](ARCHITECTURE.md) ·
[`AGENTS.md`](AGENTS.md) (working contract) · [`docs/TESTING.md`](docs/TESTING.md) (test strategy +
hardware smoke-test checklist).

### Related repositories

- [**brvg-cloud-server**](https://github.com/Boat-RV-Guardian/brvg-cloud-server) — the self-hostable
  server (Docker/Node): webhooks, push, flood shutoff, history, admin console.
- [**website-boatrvguardian**](https://github.com/Boat-RV-Guardian/website-boatrvguardian) — the
  marketing site at [boatrvguardian.com](https://boatrvguardian.com).
- [**brvg-admin-site**](https://github.com/Boat-RV-Guardian/brvg-admin-site) — the hosted-service
  operator console.

## Contributing

Guardian is community-driven, and contributions are genuinely welcome — especially from people who
live this life.

- 🐛 **Found a bug?** [Open an issue.](https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/issues)
- 💬 **Have a question or idea?** [Start a discussion.](https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/discussions)
- 🛠️ **Want to build something?** Fork the repo and send a pull request (read
  [AGENTS.md](AGENTS.md) first).
- 🔌 **Use hardware we don't support yet?** Tell us — new sensor integrations are a priority.

## License

Released under the **GPL-3.0** license — see [`LICENSE`](LICENSE). You're free to use, study,
modify, and redistribute it; the project can't be taken away from you.

## Disclaimer

Boat & RV Guardian is a monitoring aid, not a guarantee. Always follow marine and RV
electrical/plumbing best practices, and don't rely on any single system to protect life or
property. Install fuses, test your setup, and confirm alerts actually reach you before you depend
on them.

## Quality Assurance & Ecosystem

This project is part of the Boat RV Guardian ecosystem. For overarching architecture, AI workflows, and the QA Audit checklist, please see the [brvg-ecosystem](../brvg-ecosystem) repository.
