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

1. Open your terminal and navigate to the `cloudflare/` folder in this project:
   ```bash
   cd cloudflare
   ```
2. Create a KV Namespace to store the device tokens:
   ```bash
   npx wrangler kv:namespace create FCM_TOKENS
   ```
   *Wrangler will output an ID. Copy that ID.*
3. Open `cloudflare/wrangler.toml` and replace `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` with the ID you just copied. Also, replace `FIREBASE_PROJECT_ID` with your actual Firebase Project ID.
4. Deploy the worker:
   ```bash
   npx wrangler deploy
   ```
5. Set the secret credentials you got from Step 2:
   ```bash
   npx wrangler secret put FIREBASE_CLIENT_EMAIL
   # Paste the client_email from the json file
   
   npx wrangler secret put FIREBASE_PRIVATE_KEY
   # Paste the EXACT private_key from the json file (including the -----BEGIN and END lines)
   ```

## Step 4: Link the App to the Worker

1. After deploying the worker, Cloudflare will give you a URL (e.g., `https://boat-rv-guardian-notifications.YOUR_USERNAME.workers.dev`).
2. Open `src/hooks/usePushNotifications.ts` in the React project.
3. Update the `WORKER_URL` variable with your actual Cloudflare Worker `/register` URL.

## Step 5: Configure your Sensors (Shelly)

1. Go to your Shelly Flood Gen4's local web interface.
2. Go to **Actions** or **Webhooks**.
3. Add an action for **Water Detected**.
4. Set the URL to your Cloudflare Worker Webhook: `https://boat-rv-guardian-notifications.YOUR_USERNAME.workers.dev/webhook`
5. Save.

**You're done!** When the Shelly detects water, it will ping your Cloudflare Worker, which will fetch your phone's token and send a high-priority push notification via Firebase.
