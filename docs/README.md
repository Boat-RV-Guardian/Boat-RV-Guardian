# Docs index

Everything in `docs/`, plus the root-level docs and where to find user-facing documentation.

## In this directory

| Doc | What it covers |
| --- | --- |
| [USE_CASES.md](USE_CASES.md) | The six scenarios Guardian is built for — risks, features, tiers, and recommended hardware for each. |
| [SELF_HOST.md](SELF_HOST.md) | The self-hostable server: original design rationale (since shipped as [brvg-cloud-server](https://github.com/Boat-RV-Guardian/brvg-cloud-server)). |
| [TESTING.md](TESTING.md) | Test strategy, CI gates, and the manual hardware smoke-test checklist for the safety-critical paths. |
| [COST_ANALYSIS.md](COST_ANALYSIS.md) | Data-volume and cost analysis behind the hosted-backend choice (Workers + D1 vs Firestore). |
| [DOMAIN_MIGRATION.md](DOMAIN_MIGRATION.md) | The move of user-facing URLs to `boatrvguardian.com` subdomains (code side shipped). |
| [UI_IA_PROPOSAL.md](UI_IA_PROPOSAL.md) | The approved app UI / information-architecture redesign (Overview / Systems / Alerts / Settings). |
| [images/](images) | Diagrams used by the docs (hose-burst protection, RV setup). |

## Root-level docs

| Doc | What it covers |
| --- | --- |
| [../README.md](../README.md) | Project overview: features, hardware, modes, pricing, platforms, developer quick-start. |
| [../ARCHITECTURE.md](../ARCHITECTURE.md) | Repo layout, Firebase backend, hardware integrations, and local vs cloud polling. |
| [../AGENTS.md](../AGENTS.md) | The working contract for contributors and agents — safety model, gates, invariants. |
| [../LOCAL_API_SETUP.md](../LOCAL_API_SETUP.md) | Using the LinkTap Gateway's local API from the web app (CORS / mixed-content workarounds). |
| [../PUSH_NOTIFICATIONS_SETUP.md](../PUSH_NOTIFICATIONS_SETUP.md) | Wiring Firebase Cloud Messaging + the Cloudflare Worker for push while the app is closed. |

## User-facing documentation

End-user guides (getting started, devices, support) live on the website:
[boatrvguardian.com/docs](https://boatrvguardian.com/docs/).
