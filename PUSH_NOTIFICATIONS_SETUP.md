# Push Notifications Setup Guide (Firebase + Cloudflare)

This guide walks you through the steps to get push notifications working even when the Boat & RV Guardian app is closed. We use a **Cloudflare Worker** to listen for events (like a Shelly water detector) and **Firebase Cloud Messaging (FCM)** to send the alert to your phone.

## Step 1: Set up a Firebase Project (Free)

1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add Project** and name it "Boat-RV-Guardian" (disable Google Analytics to keep things simple).
3. Once the project is created, click the **Android** icon to add an Android app.
   - **Android package name:** `com.jgearinger.boatrvguardian` (must match your `capacitor.config.ts`).
   - Click **Register app**.
4. **Download google-services.json**:
   - Save this file to your `android/app/` folder in the project. This is required for Capacitor to connect to Firebase.
   - Click Next until you return to the console.

*(Note: If you plan to build for iOS, add an iOS app in Firebase and place the `GoogleService-Info.plist` in your Xcode project root).*

## Step 2: Get the Service Account Key for Cloudflare

Our Cloudflare worker needs permission to send push notifications on behalf of your Firebase project.

1. In the Firebase Console, click the **Gear Icon** (Project Settings) > **Service Accounts**.
2. Click **Generate new private key**.
3. Download the `.json` file. It will contain a `client_email` and a `private_key`. Keep this safe!

## Step 3: Deploy the Cloudflare Worker

The worker lives in the **`worker/`** folder of this repo (deployed as `boat-rv-guardian-webhooks`,
serving `https://api.boatrvguardian.com`). For the hosted project, pushes to `worker/**` auto-deploy
via CI — you only need these manual steps for a **self-hosted** worker or first-time setup.

1. From the repo root:
   ```bash
   cd worker
   npm install
   ```
2. In `worker/wrangler.toml`, confirm the `FIREBASE_PROJECT_ID` var matches your Firebase project id.
   (Push tokens are stored in **Firestore** at `users/{uid}.fcmToken` — the app writes them on login,
   so there is **no** KV namespace to create and no manual token registration.)
3. Deploy:
   ```bash
   npx wrangler deploy      # or `npx wrangler deploy --dry-run` to validate without shipping
   ```
4. Set the service-account secrets from Step 2:
   ```bash
   npx wrangler secret put FIREBASE_CLIENT_EMAIL   # paste client_email from the json
   npx wrangler secret put FIREBASE_PRIVATE_KEY    # paste the EXACT private_key (incl. BEGIN/END lines)
   ```
5. In Google Cloud, make sure the **Firebase Cloud Messaging API** is enabled and the service account
   has the **Firebase Cloud Messaging Admin** role (otherwise FCM sends return 403).

## Step 4: The app is already linked

The app targets `DEFAULT_WORKER_URL` (`https://api.boatrvguardian.com`) out of the box — there is **no
`WORKER_URL` to edit**. To point a device at a self-hosted worker instead, set a per-vehicle **Custom
Cloud Server URL** in **Settings → Vehicles** (stored as `sh_webhook_url`). The app writes the phone's
FCM token to `users/{uid}.fcmToken` automatically after you sign in and grant notification permission.

## Step 5: Configure your Sensors (Shelly)

The app **registers these webhooks for you** during Shelly provisioning (it discovers each device's
real events via `Webhook.ListSupported`). If you ever set one by hand, the URL format is:

```
https://api.boatrvguardian.com/api/shelly?vid=<your-vehicle-id>&event=<event-name>
```

(For a self-hosted worker, swap the host for your own.) When the Shelly detects water it pings the
worker, which reads the vehicle's `allowedUsers` + their FCM tokens from Firestore, closes the LinkTap
valve, and sends a high-priority push via Firebase.
