# Setting up the Local API on the Web Dashboard

If you are using the downloaded Native Mac or Windows apps, the Local API works immediately with zero configuration. 

However, if you prefer to use the **Live Web Dashboard** via a browser to connect to your LinkTap Gateway's Local API (`http://192.168.x.x`), you must bypass two strict browser security features: **CORS** and **Mixed Content Blocking**. 

Because the web dashboard runs on a secure HTTPS connection and your gateway runs on a local HTTP connection, modern browsers will block the communication by default.

Here is exactly how to configure Google Chrome or Microsoft Edge to allow the connection:

> **Important:** Safari permanently bans mixed content and cannot be used for the Local API on the web. You must use Chrome, Edge, or Firefox.

## Step 1: LinkTap Hardware Setup
**Note:** The LinkTap API does not support initial hardware pairing. You *must* use the official LinkTap app for this first step.

1. Follow the official LinkTap instructions to connect your Gateway to your home Wi-Fi network.
2. Insert batteries into the LinkTap G2S Valve and pair it with the Gateway using the official LinkTap mobile app.
4. Verify that you can manually turn the water on and off using the official LinkTap app before proceeding.

## Step 2: Install & Enable a CORS Extension

Browsers require the gateway to send `Access-Control-Allow-Origin` headers. Since the LinkTap gateway doesn't send these, we use an extension to inject them.

1. Install a CORS unblocker extension, such as [Allow CORS: Access-Control-Allow-Origin](https://chromewebstore.google.com/detail/allow-cors-access-control/lhobafahddgcelffkeicbaginigeejlf).
2. Once installed, click the **Puzzle Piece** icon in your browser toolbar and pin the extension so you can see it.
3. Click the extension icon and toggle the main switch to **ON**. The icon will usually change from gray to colored to indicate it is active.

## Step 3: Allow "Insecure Content" (Crucial)

Even with the CORS extension on, Chrome will block the connection because it is a "Mixed Content" violation (HTTPS trying to fetch from HTTP).

1. Open the Boat & Rv Guardian web dashboard (`https://app.boatrvguardian.com/`).
2. Click the **Padlock** or **Settings icon** located in your browser's address bar, directly to the left of the URL.
3. Click on **Site Settings**. This will open a new Chrome settings tab.
4. Scroll down the list of permissions until you find **Insecure content**.
5. Change the dropdown menu from "Block (default)" to **Allow**.
6. Close the Site Settings tab. 
7. Chrome will show a banner at the top of the dashboard asking you to reload. Click **Reload** (or do a hard refresh: `Cmd + Shift + R`).

## Step 4: Connect!

1. Open the dashboard Settings (gear icon).
2. Go to **Hardware Connections** and select **Local API**.
3. Enter your Gateway's local IP address (e.g., `192.168.1.50`).
4. Enter your exact 16-character Gateway ID and Device ID.
5. Click **Apply & Connect**.

The dashboard will now seamlessly poll your local gateway every 2 seconds for ultra-fast leak detection. 

*(Note: If you use the dashboard frequently, you can leave the CORS extension and site permissions enabled. If you have security concerns, you can toggle the CORS extension off when you are not using the dashboard).*
