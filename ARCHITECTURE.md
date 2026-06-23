# Boat & Rv Guardian - Architecture

This document outlines the software architecture and hardware integration strategy for the Boat & Rv Guardian application.

## 1. Monorepo Architecture

The repository is structured into three main domains to ensure scalability, ease of development, and clear separation of concerns:

### `/website` (Marketing & Documentation)
- **Framework:** Astro
- **Purpose:** A fast, SEO-friendly static site for marketing, pricing, and support documentation.
- **Editing:** Content can be easily added by creating Markdown (`.md`) or Astro (`.astro`) files in `website/src/pages/`.
- **Hosting:** Cloudflare Pages.

### `/dashboard` (The Guardian App)
- **Framework:** React + Vite + Tauri
- **Purpose:** The core client application where users monitor their vessels, manage sensors, and control valves.
- **Deployment:** Can be run in the browser (PWA), on Desktop (macOS/Windows via Tauri), and Mobile (iOS/Android via Capacitor).
- **Hosting:** Cloudflare Pages (for the web version).

### `/worker` (Webhook Receiver)
- **Framework:** Cloudflare Workers (TypeScript)
- **Purpose:** A serverless function that acts as a public endpoint to receive incoming webhooks from remote Shelly sensors (e.g., when water is detected while the user is away). It processes the alert, securely looks up the user's LinkTap API keys, and triggers a remote shutoff command while sending a push notification.

## 2. Backend & Authentication (Firebase)
We utilize **Firebase** to handle all user accounts and data synchronization.
- **Firebase Auth:** Secures the dashboard. Users must log in to view their dashboard.
- **Firestore:** A NoSQL database storing user profiles and device configurations. 
  - *Example:* Instead of hardcoding LinkTap API keys into the app, they are securely stored in Firestore and fetched upon login.

## 3. Hardware Setup & Integrations
The system aggregates data and controls from two primary hardware ecosystems:

### A. The Valve & Gateway (LinkTap)
- **LinkTap Gateway (GW-01 / GW-02):** Acts as the bridge.
- **LinkTap Smart Valve (G2S):** Must include a built-in flow meter to provide real-time flow rate data.

### B. Third-Party Sensors (Shelly Flood Gen4 / Webhooks)
- **Direct Wi-Fi Sensors:** Devices like the Shelly Flood Gen4 connect directly to the local Wi-Fi router.
- **Webhook Integration:** The Shelly sensors are configured to fire a webhook to the public URL of the Cloudflare Worker when water is detected.
- **Trigger Action:** The Worker receives the webhook, queries Firestore to find the associated LinkTap API key, and instantly fires an emergency "Close Valve" command to the LinkTap API.

## 4. Polling Strategies

### Local API Mode (High-Frequency, Desktop/Mobile Native Only)
- **Endpoint:** `http://<GATEWAY_IP>/api/...`
- **Polling Rate:** High-frequency (e.g., every 1–2 seconds).
- **Pros:** Ultra-low latency, zero internet required.

### Cloud API Mode (Low-Frequency, Web Version)
- **Endpoint:** `https://www.link-tap.com/api/...`
- **Polling Rate:** Low-frequency (e.g., every 30–60 seconds) to respect LinkTap's rate limits.
- **Pros:** Works remotely from anywhere in the world. Usable via standard web browsers.
