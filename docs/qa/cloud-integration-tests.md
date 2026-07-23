# Comprehensive Cloud Integration QA Plan

Testing local-only mode doesn't validate the most critical parts of the Boat RV Guardian ecosystem. To truly QA the system, we must test the full **Cloud Integration** (Firebase Auth, Cloudflare Workers, Webhooks, and Push Notifications) end-to-end.

**Prerequisite:** Create a throwaway account (e.g., `test1@brvg-tests.com` — this domain skips the email verification banner). You will need the `brvg-cloud-server` worker URL to fire synthetic webhooks.

---

## 1. Authentication & Tier Provisioning

*   **Test 1.1: Account Creation & Profile Sync**
    *   *Action:* Sign up via the app. 
    *   *Check:* Verify in Firebase console (or Admin Site) that a `users/{uid}` document was created.
*   **Test 1.2: Default Tier Assignment**
    *   *Action:* Check Account Settings.
    *   *Check:* Ensure the default tier is correctly assigned as **Free**.
*   **Test 1.3: Device Limits Enforcement (Cloud-Side)**
    *   *Action:* Attempt to add 4 dummy sensors (the Free limit is 3).
    *   *Check:* The app should block the 4th addition. If you force the API, the backend should return a `device_limit_reached` error.

## 2. Cloud Webhooks & Telemetry Ingestion (The Worker)

*   **Test 2.1: Authentication Rejection (SEC-4)**
    *   *Action:* Send a synthetic `curl` POST to the worker mimicking a Shelly H&T (`event: temperature.change`), but **without** the `&k=` secret.
    *   *Check:* The worker MUST reject the request (Fail-closed webhook auth).
*   **Test 2.2: Telemetry Merging**
    *   *Action:* Send a valid webhook with `extra: { tC: "25.9" }`. Wait 2 seconds. Send another valid webhook with `extra: { rh: "42" }`.
    *   *Check:* Check the Admin site or the App. The Environment card must show *both* values. The second webhook should not have wiped out the temperature.
*   **Test 2.3: Battery vs Shore Power (PM Mini G3)**
    *   *Action:* Simulate a PM Mini G3 webhook (`event: pm1.voltage_change`, `voltage: 118`). 
    *   *Check:* Ensure the cloud server parses this correctly into the `v=` parameter and the app displays it as Shore Power (Volts), rather than triggering a false push notification.

## 3. The Safety Chain (Flood → Auto Shut-off)

*   **Test 3.1: Flood Detection to Worker**
    *   *Action:* Use `curl` to fire a simulated `flood.alarm` webhook to the worker using your test vehicle's credentials (`vid` and `&k=`).
    *   *Check:* `wrangler tail` should show the worker receiving the alarm.
*   **Test 3.2: Worker to LinkTap Relay**
    *   *Action:* The worker should instantly look up the vehicle's LinkTap API keys from Firestore and fire a "Shutoff" command to the LinkTap API.
    *   *Check:* The worker logs should read: `flood event flood.alarm on [vid]: shutoff {"ok":true,"valves":1}`.
*   **Test 3.3: Push Notification (FCM / Ntfy)**
    *   *Action:* Wait 2 seconds after the flood webhook.
    *   *Check:* A push notification should arrive on your mobile device, or a message should appear in your configured Ntfy topic.

## 4. Vehicle Sharing & Role-Based Access Control (RBAC)

**Prerequisite:** Create a second throwaway account (`test2@brvg-tests.com`).

*   **Test 4.1: Invites & Discovery**
    *   *Action:* As User 1, invite User 2 to the vehicle as a `monitor`.
    *   *Check:* User 2 should see a pending invite in their Friends tab without receiving an email.
*   **Test 4.2: Monitor Role Enforcement (App)**
    *   *Action:* As User 2 (Monitor), open the valve control screen.
    *   *Check:* The UI should display a banner indicating "Monitor Only" and valve control buttons should be disabled or no-op when clicked.
*   **Test 4.3: Firestore Security Rules (SEC-13)**
    *   *Action:* Attempt to maliciously escalate User 2's role to `admin` by directly patching the Firestore document via the console or a script using User 2's Auth Token.
    *   *Check:* The Firestore rule (`014945d5-...`) MUST reject the write. A member cannot forge their tier or escalate their role.

## 5. Offline & Gateway Discovery (Edge Cases)

*   **Test 5.1: Missing Gateway IP Handling**
    *   *Action:* Clear the LinkTap Gateway IP from the app's advanced settings (simulating a network change).
    *   *Check:* The app should seamlessly fall back to the low-frequency Cloud API (polling every 30-60s) rather than breaking. 
*   **Test 5.2: LAN Discovery**
    *   *Action:* Reconnect to the local network. 
    *   *Check:* The desktop/mobile app should use native network permissions (`NSLocalNetworkUsageDescription` on Mac) to automatically rediscover the gateway IP (`172.31.0.244` or similar) and resume high-frequency 5-second polling.
