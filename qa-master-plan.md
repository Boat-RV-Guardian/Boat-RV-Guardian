# Boat RV Guardian — QA Master Plan

This document is the central index for Quality Assurance in the Boat RV Guardian ecosystem. Because this project spans a desktop/mobile app, cloud serverless workers, webhooks, and IoT hardware, testing requires a multi-layered approach.

## Testing Philosophy
1. **Never test with real user data** when validating structural changes. Always use local modes, emulator modes, or the `@brvg-tests.com` throwaway domains.
2. **The Cloud is the Critical Path:** The app UI is just a view; the core safety mechanism is the Cloudflare worker receiving webhooks and firing the LinkTap API.
3. **Automated AI Audits:** Use the custom AI `ecosystem-qa` skill (located in the `brvg-ecosystem` repository) for deep, automated code and schema auditing.

## Detailed Test Plans

Detailed execution steps for QA checks are maintained in the `docs/qa/` directory:

*   **[Cloud Integration Tests](docs/qa/cloud-integration-tests.md)**
    *   *What it covers:* Firebase Auth, Security Rules (RBAC), Tier limits, and end-to-end webhook-to-valve safety chains.
    *   *When to use:* After any change to `firestore.rules`, `worker/`, or webhook logic.
*   **[UI Agent Tests](docs/qa/ui-agent-tests.md)**
    *   *What it covers:* Verifying the frontend application behaves correctly in a live browser.
    *   *When to use:* When making major component layout changes, React state refactors, or navigation updates. Can be executed by an AI Browser Subagent.

## Environments

*   **Demo Site:** `demo.boatrvguardian.com` (Simulates devices and deterministic telemetry for UI testing without real hardware).
*   **Local App:** The Tauri/Vite app running on `localhost:1420` (use Local-Only mode to avoid cloud sync bleeds).
*   **Admin Site:** `brvg-admin-site` running locally via `npm run dev` against the Firebase Emulator suite.
