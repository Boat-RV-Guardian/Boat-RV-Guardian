/// <reference types="@capacitor-firebase/authentication" />
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jgearinger.boatrvguardian',
  appName: 'Boat & RV Guardian',
  webDir: 'dist',
  server: {
    androidScheme: 'http',
    allowNavigation: ['192.168.*', '10.*', '172.16.*', '172.31.*'],
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
