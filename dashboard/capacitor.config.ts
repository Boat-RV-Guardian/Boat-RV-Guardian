/// <reference types="@capacitor-firebase/authentication" />
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jgearinger.boatrvguardian',
  appName: 'Boat & RV Guardian',
  webDir: 'dist',
  android: {
    // Android 15+ (targetSdk 35+) forces edge-to-edge, drawing the WebView behind the system
    // gesture/nav bar — but the WebView reports env(safe-area-inset-bottom) as 0, so the bottom
    // tab bar was clipped by the gesture pill. 'auto' has Capacitor apply window-inset margins
    // exactly when the OS enforces edge-to-edge (no effect on older Android).
    adjustMarginsForEdgeToEdge: 'auto',
  },
  server: {
    androidScheme: 'http',
    // Cleartext HTTP is required for direct LAN device RPC (LinkTap gateway / Shelly at http://<ip>).
    // Scope allowNavigation to the RFC1918 private ranges: 10/8, 192.168/16, and the FULL 172.16/12
    // (172.16–172.31 — the old list only had .16 and .31, missing .17–.30, e.g. many Docker/router LANs).
    allowNavigation: [
      '192.168.*',
      '10.*',
      '172.16.*', '172.17.*', '172.18.*', '172.19.*', '172.20.*', '172.21.*', '172.22.*', '172.23.*',
      '172.24.*', '172.25.*', '172.26.*', '172.27.*', '172.28.*', '172.29.*', '172.30.*', '172.31.*',
    ],
    cleartext: true
  },
  plugins: {
    // Global fetch/XHR patching is OFF on purpose: it breaks Firestore's long-polling
    // connection on Android (cloud sync returns nothing). Cross-origin device/cloud calls
    // use the CapacitorHttp plugin method explicitly via utils/nativeFetch instead.
    CapacitorHttp: {
      enabled: false
    },
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ["google.com"]
    }
  }
};

export default config;
