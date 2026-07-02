# 🛟 Boat & RV Guardian

**Free, open-source monitoring that protects your boat or RV — even when you're miles away.**

A dead battery stops your bilge pump. A burst line on an unlimited city-water hookup can flood a cabin or sink a boat. A tripped shore-power pedestal quietly thaws your fridge. These failures are almost always *quiet* — they happen while you're asleep, at work, or three states away.

Boat & RV Guardian watches for them and acts. It turns affordable, off-the-shelf smart-home hardware — **LinkTap** valves and **Shelly** sensors — into a purpose-built safety system for vessels and rigs, and sends the alert straight to your phone. The core app is free and open-source. Your only required cost is the hardware you choose.

<p align="center">
  <a href="https://boatrvguardian.com"><b>🌐 Website</b></a> &nbsp;·&nbsp;
  <a href="https://app.boatrvguardian.com"><b>🚀 Launch the Web App</b></a> &nbsp;·&nbsp;
  <a href="https://boatrvguardian.com/devices"><b>🛠️ Supported Devices</b></a> &nbsp;·&nbsp;
  <a href="https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/releases"><b>📦 Download</b></a>
</p>

> Built by boaters and RVers, for boaters and RVers. Free core app, no vendor lock-in, no data held hostage.

---

## Why it exists

Marine and RV monitoring has long meant proprietary hardware at marine prices, walled-garden apps, and a monthly bill just to keep watching your own boat. Meanwhile, the home-automation world has cheap, reliable, well-documented sensors that do the exact same jobs.

Guardian bridges that gap — and gives it away, so cost is never the reason a vessel or rig goes unprotected.

## What it protects

- **🌊 Automatic water shutoff** — LinkTap smart valves meter real-time flow and slam shut the instant usage runs past your limit, stopping a burst line before it floods.
- **🔋 12V & shore-power health** — Track house and starter banks plus AC shore power, so a dead battery never strands you — or your bilge pump.
- **🚨 Instant flood alarms** — Shelly Flood sensors fire straight to the cloud, delivering a push notification the second water is detected, wherever you are.
- **🏠 Local-first & private** — Aboard and off-grid, the app talks directly to your sensors with zero latency and no internet. Cloud mode takes over automatically when you leave.
- **💻 Runs everywhere** — Web dashboard, native macOS/Windows desktop apps, and Android.

## Who it's for

Liveaboards, weekend cruisers, full-time RVers, and weekend campers — anyone who leaves a vessel or rig unattended and would rather get a phone alert than a repair bill.

## Get started in three steps

1. **Pick your hardware.** Choose a kit or individual LinkTap and Shelly parts — each with an estimated price — on **[Supported Devices](https://boatrvguardian.com/devices)**.
2. **Get the app.** **[Launch the web dashboard](https://app.boatrvguardian.com)** instantly in any browser, or **[download](https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/releases)** a native app for macOS, Windows, or Android.
3. **Install & configure.** Mount the valve at the spigot, pair your sensors, and set your alerts using the **[Getting Started guide](https://boatrvguardian.com/getting-started)**.

Questions or stuck on something? Head to **[Support](https://boatrvguardian.com/support)**.

## How it works

When you're on the same network as your hardware, the app uses a **local connection** for instant, internet-free control. When you're away, Shelly sensors fire webhooks to a **Cloudflare Worker**, which alerts you and can trigger an emergency shutoff through the LinkTap cloud API.

```
LOCAL (aboard)     Phone / Laptop  <->  LinkTap Gateway  <->  Smart Valve
                   Direct, zero-latency control. No internet required.

CLOUD (away)       Flood Sensor  ->  Cloudflare Worker  ->  Push Notification
                                                         +  Remote Valve Shutoff
```

## What it costs

The app is free — your only cost is hardware.

| System | Hardware | Est. cost |
| --- | --- | --- |
| City water control | LinkTap valve + Gateway | ~$135–160 |
| Flood / high water | Shelly Flood Gen4 | ~$30 each |
| 12V battery monitoring | Shelly Plus Uni + fused harness + enclosure | ~$45 |
| Shore power | Shelly PM Mini Gen3 | ~$25 |

A typical full build runs **~$265–290**. Estimates only — prices vary by region. Full list with buy links: **[Supported Devices](https://boatrvguardian.com/devices)**.

> Some advanced features may become optional paid add-ons in the future to help sustain the project. The core monitoring and protection will always be free.

---

## For developers

This repository holds two domains — the app and its webhook backend:

| Path | What it is |
| --- | --- |
| [`/dashboard`](dashboard) | The core app (React + Vite), packaged for Web, Desktop (Tauri), and Mobile (Capacitor). |
| [`/worker`](worker) | Cloudflare Worker that receives Shelly webhooks and triggers LinkTap shutoffs + push alerts. |

The **marketing website** and the **operator admin console** live in separate repositories
(`website-boatrvguardian` and `brvg-admin-site`), each auto-deployed to Cloudflare Pages.

**Stack:** React · Vite · TypeScript · Tauri · Capacitor · Firebase (Auth + Firestore) · Cloudflare Workers.

```bash
# Dashboard app (web)
cd dashboard && npm install && npm run dev

# Dashboard app (desktop)
cd dashboard && npm run tauri dev

# Webhook worker
cd worker && npm install && npm run deploy
```

Deeper technical docs: [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`LOCAL_API_SETUP.md`](LOCAL_API_SETUP.md) · [`PUSH_NOTIFICATIONS_SETUP.md`](PUSH_NOTIFICATIONS_SETUP.md)

## Contributing

Guardian is community-driven, and contributions are genuinely welcome — especially from people who live this life.

- 🐛 **Found a bug?** [Open an issue.](https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/issues)
- 💬 **Have a question or idea?** [Start a discussion.](https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/discussions)
- 🛠️ **Want to build something?** Fork the repo and send a pull request.
- 🔌 **Use hardware we don't support yet?** Tell us — new sensor integrations are a priority.

## License

Released under the **GPL-3.0** license — see [`LICENSE`](LICENSE). You're free to use, study, modify, and redistribute it; the project can't be taken away from you.

## Disclaimer

Boat & RV Guardian is a monitoring aid, not a guarantee. Always follow marine and RV electrical/plumbing best practices, and don't rely on any single system to protect life or property. Install fuses, test your setup, and confirm alerts actually reach you before you depend on them.
