// Alarm sound + alert notifications, extracted from LinkTapWidget (Task 3 hook-split).
//
// Owns the alarm/notification user preferences (lt_alarm_sound / lt_alarm_vol /
// lt_alarm_repeat / lt_notifications — rehydrated on settings_updated, same as the
// widget did), the active-alarm repeat loop, the synthesized WebAudio alarm, and
// triggerAlert (log + sound + web/Tauri/Capacitor local notification). Also hosts the
// global 'test_alert' listener. Behavior is unchanged from the original inline version.
import { useState, useEffect } from 'react';
import { isTauriEnv } from '../utils/linktapHttp';
import type { AlertLog } from './useDeviceHistory';

export interface AlarmNotifications {
  triggerAlert: (title: string, message: string, silent?: boolean) => Promise<void>;
  playSynthesizedAlarm: (soundOverride?: string) => void;
  activeAlarmSound: string | null;
  setActiveAlarmSound: React.Dispatch<React.SetStateAction<string | null>>;
  alarmRepeatInterval: 'once' | '5' | '15' | '30' | '60';
}

export function useAlarmNotifications(addLog: (type: AlertLog['type'], message: string) => void): AlarmNotifications {
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => localStorage.getItem('lt_notifications') === 'true');
  const [alarmSound, setAlarmSound] = useState<'siren' | 'beep' | 'off'>(() => (localStorage.getItem('lt_alarm_sound') as any) || 'beep');
  const [alarmVolume, setAlarmVolume] = useState(() => Number(localStorage.getItem('lt_alarm_vol') || '1.0'));
  const [alarmRepeatInterval, setAlarmRepeatInterval] = useState<'once' | '5' | '15' | '30' | '60'>(() => (localStorage.getItem('lt_alarm_repeat') as any) || 'once');
  const [activeAlarmSound, setActiveAlarmSound] = useState<string | null>(null);

  // Sync Cloud/Settings changes down to local state (same event the widget listens to).
  useEffect(() => {
    const handleSettingsUpdate = () => {
      setNotificationsEnabled(localStorage.getItem('lt_notifications') === 'true');
      setAlarmSound((localStorage.getItem('lt_alarm_sound') as any) || 'beep');
      setAlarmVolume(Number(localStorage.getItem('lt_alarm_vol') || '1.0'));
      setAlarmRepeatInterval((localStorage.getItem('lt_alarm_repeat') as any) || 'once');
    };
    window.addEventListener('settings_updated', handleSettingsUpdate);
    return () => window.removeEventListener('settings_updated', handleSettingsUpdate);
  }, []);

  // Repeat the active alarm on the configured interval until acknowledged.
  useEffect(() => {
    if (activeAlarmSound && alarmRepeatInterval !== 'once') {
      const interval = setInterval(() => {
        playSynthesizedAlarm(activeAlarmSound);
      }, Number(alarmRepeatInterval) * 1000);
      return () => clearInterval(interval);
    }
  }, [activeAlarmSound, alarmRepeatInterval]);

  const playSynthesizedAlarm = (soundOverride?: string) => {
    const soundToPlay = soundOverride || alarmSound;
    if (soundToPlay === 'off') return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      if (soundToPlay === 'siren') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(400, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(800, ctx.currentTime + 0.5);
        osc.frequency.linearRampToValueAtTime(400, ctx.currentTime + 1.0);
        osc.frequency.linearRampToValueAtTime(800, ctx.currentTime + 1.5);
        osc.frequency.linearRampToValueAtTime(400, ctx.currentTime + 2.0);

        gainNode.gain.setValueAtTime(0.5 * alarmVolume, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01 * alarmVolume, ctx.currentTime + 2.0);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 2.0);
      } else if (soundToPlay === 'beep') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1000, ctx.currentTime);
        gainNode.gain.setValueAtTime(1.0 * alarmVolume, ctx.currentTime);
        gainNode.gain.setValueAtTime(0, ctx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(1.0 * alarmVolume, ctx.currentTime + 0.2);
        gainNode.gain.setValueAtTime(0, ctx.currentTime + 0.3);
        gainNode.gain.setValueAtTime(1.0 * alarmVolume, ctx.currentTime + 0.4);
        gainNode.gain.exponentialRampToValueAtTime(0.01 * alarmVolume, ctx.currentTime + 0.5);

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.5);
      }
    } catch (e) {
      console.error('AudioContext failed:', e);
    }
  };

  const triggerAlert = async (title: string, message: string, silent: boolean = false) => {
    if (!silent && alarmSound !== 'off') {
      playSynthesizedAlarm(alarmSound);
      setActiveAlarmSound(alarmSound);
    }
    addLog(silent ? 'info' : 'danger', `${title}: ${message}`);

    if (!notificationsEnabled) return;

    if ('Notification' in window && typeof (window as any).Capacitor === 'undefined' && !isTauriEnv()) {
      if (Notification.permission === 'granted') {
        new Notification(title, { body: message });
      } else if (Notification.permission !== 'denied') {
        const p = await Notification.requestPermission();
        if (p === 'granted') new Notification(title, { body: message });
      }
    }

    if (isTauriEnv()) {
      try {
        const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification');
        let permissionGranted = await isPermissionGranted();
        if (!permissionGranted) {
          const permission = await requestPermission();
          permissionGranted = permission === 'granted';
        }
        if (permissionGranted) {
          sendNotification({ title, body: message });
        }
      } catch (e) {
        console.error('Tauri notification failed:', e);
      }
    }

    if (typeof (window as any).Capacitor !== 'undefined') {
      const Cap = (window as any).Capacitor;
      if (Cap.isNativePlatform() && Cap.Plugins && Cap.Plugins.LocalNotifications) {
        try {
          const LN = Cap.Plugins.LocalNotifications;
          let p = await LN.checkPermissions();
          if (p.display !== 'granted') {
             p = await LN.requestPermissions();
          }
          if (p.display === 'granted') {
            await LN.schedule({
              notifications: [{
                  title,
                  body: message,
                  id: Math.floor(Math.random() * 100000),
                  schedule: { at: new Date(Date.now() + 1000) }
              }]
            });
          }
        } catch (e) {
          console.error('Capacitor notification failed:', e);
        }
      }
    }
  };

  // Global "Test Alert" hook (fired from Settings). Registered once, like the original
  // widget listener (the closure reads mount-time prefs — preserved as-is).
  useEffect(() => {
    const handleTestAlert = () => { triggerAlert('Test Alert', 'This is a test of the Boat & RV Guardian alert system.'); };
    window.addEventListener('test_alert', handleTestAlert);
    return () => window.removeEventListener('test_alert', handleTestAlert);
  }, []);

  return { triggerAlert, playSynthesizedAlarm, activeAlarmSound, setActiveAlarmSound, alarmRepeatInterval };
}
