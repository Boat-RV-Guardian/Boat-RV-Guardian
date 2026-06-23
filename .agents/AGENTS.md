# Agent Guidance for Boat-RV-Guardian

This file defines the strict architectural rules and guidelines for any autonomous agent working on the Boat-RV-Guardian repository.

## 1. Repository Structure
This repository holds the application and its backend. The marketing website now lives in a
**separate repo** (`Boat-RV-Guardian/website-boatrvguardian`, Astro) — it is not in this tree.
- `/dashboard`: The core React web application, built with **Vite** and packaged via **Tauri**. This contains all complex logic, hardware integrations, and the user interface for monitoring. **Do not use Next.js here.**
- `/worker`: A **Cloudflare Worker** designed to receive webhooks from remote Shelly sensors and route them to the dashboard or LinkTap API.

## 2. Backend Services
- We use **Firebase** for backend services (Authentication and Firestore).
- The `dashboard` must authenticate users via Firebase.
- Device Configurations (like Shelly IPs, LinkTap API keys) must be stored securely in **Firestore**, NOT in local storage or hardcoded files.

## 3. Tool Selection Guidelines
- ALWAYS prioritize using the most specific tool for the task at hand.
- NEVER run `cat` inside a bash command to create a new file or append to an existing file.
- ALWAYS use `grep_search` instead of running `grep` inside a bash command unless absolutely needed.

## 4. Hardware Integrations
- **LinkTap**: Communicates via local network API (if user is local) or Cloud API (if user is remote).
- **Shelly Sensors**: Configure Shelly Gen4 devices to send HTTP Webhooks to the Cloudflare Worker URL.
