import { useState, useEffect, useRef } from 'react';
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { auth, db } from '../services/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

export function usePushNotifications() {
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  // Persist the device's FCM token to the signed-in user's doc so the worker can push to them.
  const saveToken = (t: string | null) => {
    const uid = auth.currentUser?.uid;
    if (t && uid) setDoc(doc(db, 'users', uid), { fcmToken: t }, { merge: true }).catch(() => {});
  };

  useEffect(() => {
    let isMounted = true;
    // If the token arrived before login, write it once the user signs in.
    const unsubAuth = onAuthStateChanged(auth, (u) => { if (u) saveToken(tokenRef.current); });

    const registerPush = async () => {
      // Push notifications only work on Android and iOS physical devices
      if (Capacitor.getPlatform() === 'web') return;

      try {
        let permStatus = await PushNotifications.checkPermissions();

        if (permStatus.receive === 'prompt') {
          permStatus = await PushNotifications.requestPermissions();
        }

        if (permStatus.receive !== 'granted') {
          console.warn('User denied push notification permissions');
          return;
        }

        await PushNotifications.register();

        PushNotifications.addListener('registration', async (token) => {
          if (!isMounted) return;
          // Don't log token.value — the FCM registration token is a capability handle for targeting
          // pushes to this device; keep it out of console/log sinks.
          console.log('Push registration success');
          tokenRef.current = token.value;
          setFcmToken(token.value);
          saveToken(token.value); // store on the user's Firestore doc for the worker to read
        });

        PushNotifications.addListener('registrationError', (error: any) => {
          console.error('Error on registration: ' + JSON.stringify(error));
        });

        PushNotifications.addListener('pushNotificationReceived', (notification) => {
          // Don't log the full payload (may carry alert content) — just note that one arrived.
          console.log('Push received: ' + (notification?.title || '(no title)'));
          // Local alarms or modals can be triggered here if app is open
        });

        PushNotifications.addListener('pushNotificationActionPerformed', () => {
          console.log('Push action performed');
        });
      } catch (e) {
        console.error('Push notification setup failed:', e);
      }
    };

    registerPush();

    return () => {
      isMounted = false;
      unsubAuth();
      if (Capacitor.getPlatform() !== 'web') {
        PushNotifications.removeAllListeners();
      }
    };
  }, []);

  return { fcmToken };
}
