# Agent Guidance for Boat-RV-Guardian

This file defines the strict architectural rules and guidelines for any autonomous agent working on the Boat-RV-Guardian repository.

## 1. Repository Structure
This repository holds the application and its backend. The marketing website now lives in a
**separate repo** (`Boat-RV-Guardian/website-boatrvguardian`, Astro) — it is not in this tree.
- `/dashboard`: The core React web application, built with **Vite** and packaged via **Tauri**. This contains all complex logic, hardware integrations, and the user interface for monitoring. **Do not use Next.js here.**
- `/worker`: A **Cloudflare Worker** designed to receive webhooks from remote Shelly sensors and route them to the dashboard or LinkTap API.

## 2. Backend Services
- We use **Firebase** for backend services (Authentication and Firestore) in **hosted cloud mode**.
- In cloud mode the `dashboard` authenticates users via Firebase, and Firestore is the **source of
  truth** for per-vehicle configuration (Shelly IPs, LinkTap API keys, etc.).
- **Local storage is a per-user offline cache, not a violation of this.** Config + secrets live in
  `lt_*`/`sh_*` localStorage keys stamped with the owning uid (see `utils/userScope.ts`), mirrored
  from Firestore in cloud mode and wiped on identity change. **Local-only mode** (no account) and
  self-hosted mode keep configuration **device-local by design** — there is no cloud copy in those
  modes. So: never hardcode secrets, and in cloud mode Firestore stays authoritative — but do NOT
  treat "config in localStorage" as a bug; that is the documented cache/local-only model (see the
  root [CLAUDE.md](../CLAUDE.md) "Per-user local data" and "Configuration sync model" sections).

## 3. Tool Selection Guidelines
- ALWAYS prioritize using the most specific tool for the task at hand.
- NEVER run `cat` inside a bash command to create a new file or append to an existing file.
- ALWAYS use `grep_search` instead of running `grep` inside a bash command unless absolutely needed.

## 4. Hardware Integrations
- **LinkTap**: Communicates via local network API (if user is local) or Cloud API (if user is remote).
- **Shelly Sensors**: Configure Shelly Gen4 devices to send HTTP Webhooks to the Cloudflare Worker URL.
