import { useState, useEffect, useRef } from 'react';
import { type DeviceConfig } from '../utils/VehicleManager';
import { formatTime, formatDate, getDisplayTimeZone } from '../utils/time';
import { isTauriEnv, listenTauri, unifiedFetch, extractJsonFromMaybeHtml, coerceWateringBool } from '../utils/linktapHttp';
import { normalizeCloudStatus, swapBatterySignal, pickTargetVolume, pickTargetDuration } from '../utils/linktapStatus';
import { useDeviceHistory } from '../hooks/useDeviceHistory';
import { drawFlowChart, type FlowData } from '../utils/flowChart';

const APP_VERSION = '1.0.48';

export default function LinkTapWidget({ device }: { device: DeviceConfig }) {
  // --- Persistent Gateway & Device Configuration ---
  const [isSoftwareCutoffActive, setIsSoftwareCutoffActive] = useState(false);
  const [cloudUsername, setCloudUsername] = useState(() => localStorage.getItem('lt_cloud_user') || '');
  const [cloudApiKey, setCloudApiKey] = useState(() => localStorage.getItem('lt_cloud_key') || '');
  const [alertOffline, setAlertOffline] = useState(() => localStorage.getItem('lt_alert_offline') !== 'false');
  const [gatewayIp, setGatewayIp] = useState(() => localStorage.getItem('lt_gateway_ip') || '');
  const [gatewayId, setGatewayId] = useState(() => localStorage.getItem('lt_gateway_id') || '');
  const deviceId = device.linktapDeviceId || device.id;
  const [refreshInterval, setRefreshInterval] = useState(() => Number(localStorage.getItem('lt_refresh') || '5'));
  const effectiveInterval = refreshInterval;

  const hasCustomSettings = () => {
    const gw = localStorage.getItem('lt_gateway_id');
    const dev = localStorage.getItem('lt_device_id');
    const cloud = localStorage.getItem('lt_cloud_user');
    return !!gw || !!dev || !!cloud;
  };

  const [isCloudPollingActive, setIsCloudPollingActive] = useState(() => {
    const stored = localStorage.getItem('lt_is_cloud_polling');
    if (stored === 'true') return true;
    if (hasCustomSettings()) return true;
    return false;
  });

  const [isLocalPollingActive, setIsLocalPollingActive] = useState(() => {
    const stored = localStorage.getItem('lt_is_local_polling');
    if (stored === 'true') return true;
    if (hasCustomSettings()) return true;
    return false;
  });

  // Pin to 31s when cloud-only (local disconnected) to respect the API rate limit.
  // Use the slider value when local is active for fast real-time telemetry.
  const pollInterval = (isLocalPollingActive && gatewayIp) ? effectiveInterval : 31;

  // --- Local Safety  // Auto-Guard settings
  const autoGuardEnabled = device.autoGuardEnabled !== false;

  const handleTestAlert = () => triggerAlert('Test Alert', 'This is a test of the Boat & RV Guardian alert system.');
  
  useEffect(() => {
    window.addEventListener('test_alert', handleTestAlert);
    return () => window.removeEventListener('test_alert', handleTestAlert);
  }, []);
  const maxFlowRate = device.maxFlowRate || 15;
  // --- User Preferences ---
  const [unitSystem, setUnitSystem] = useState<'metric' | 'imperial'>(() => localStorage.getItem('lt_unit') as 'metric' | 'imperial' || 'imperial');

  const [notificationsEnabled, setNotificationsEnabled] = useState(() => localStorage.getItem('lt_notifications') === 'true');
  const [alarmSound, setAlarmSound] = useState<'siren' | 'beep' | 'off'>(() => (localStorage.getItem('lt_alarm_sound') as any) || 'beep');
  const [alarmVolume, setAlarmVolume] = useState(() => Number(localStorage.getItem('lt_alarm_vol') || '1.0'));
  const [alarmRepeatInterval, setAlarmRepeatInterval] = useState<'once' | '5' | '15' | '30' | '60'>(() => (localStorage.getItem('lt_alarm_repeat') as any) || 'once');
  const [activeAlarmSound, setActiveAlarmSound] = useState<string | null>(null);
  
  const [notifyAutoGuard, setNotifyAutoGuard] = useState(() => localStorage.getItem('lt_notif_autoguard') !== 'false');

  const [notifyLowBattery, setNotifyLowBattery] = useState(() => localStorage.getItem('lt_notif_battery') === 'true');
  const [notifyWatering, setNotifyWatering] = useState(() => localStorage.getItem('lt_notif_watering') === 'true');
  const hasNotifiedBattery = useRef(false);

  // --- Real-time API States (matched to G2S Gateway Schema) ---
  const [isRfLinked, setIsRfLinked] = useState(true);

  const [isBroken, setIsBroken] = useState(false);
    const [isLeak, setIsLeak] = useState(false);
  const [isClog, setIsClog] = useState(false);
  const [signal, setSignal] = useState(85);
  const [battery, setBattery] = useState(95);
  const [isWatering, setIsWatering] = useState(false);
  const [speed, setSpeed] = useState(0.0);
  const [volume, setVolume] = useState(0.0);
  const [remainDuration, setRemainDuration] = useState(0);

  // --- Historical Data Tracking ---
  const [enableHistory, setEnableHistory] = useState(() => localStorage.getItem('lt_enable_history') !== 'false');
  const [storeHistoryCloud, setStoreHistoryCloud] = useState(() => localStorage.getItem('lt_store_history_cloud') === 'true');
  // Usage history + Event Sentry Log state, persistence, and cloud mirroring live in this hook.
  const { usageHistory, setUsageHistory, logs, addLog } = useDeviceHistory(deviceId, storeHistoryCloud);
  // Sharing role for the active vehicle ('admin' | 'control' | 'monitor'); monitor = view only.
  const [myRole, setMyRole] = useState(() => localStorage.getItem('lt_my_role') || 'admin');
  const canControl = myRole !== 'monitor';
  useEffect(() => {
    const sync = () => setMyRole(localStorage.getItem('lt_my_role') || 'admin');
    window.addEventListener('role_updated', sync);
    window.addEventListener('settings_updated', sync);
    return () => { window.removeEventListener('role_updated', sync); window.removeEventListener('settings_updated', sync); };
  }, []);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('disconnected');
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Re-render trigger so already-rendered timestamps reformat when the user changes lt_tz.
  const [displayTz, setDisplayTz] = useState(getDisplayTimeZone());
  // Modal UI state is handled elsewhere now
  
  // Dispatch connection state to external listeners (Settings.tsx)
  useEffect(() => {
    const event = new CustomEvent('connection_state_change', {
      detail: { status: connectionStatus, error: errorMsg }
    });
    window.dispatchEvent(event);
  }, [connectionStatus, errorMsg]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyTab, setHistoryTab] = useState<'hourly'|'daily'|'weekly'|'monthly'>('daily');
  const [showAutoRestartModal, setShowAutoRestartModal] = useState(false);

  // --- Manual Irrigation Inputs ---
  const [inputDuration, setInputDuration] = useState(() => Number(localStorage.getItem(`lt_input_dur_${deviceId}`) || '15'));
  const [inputVolume, setInputVolume] = useState(() => Number(localStorage.getItem(`lt_input_vol_${deviceId}`) || '50'));
  const [delayedStartMins, setDelayedStartMins] = useState(() => Number(localStorage.getItem(`lt_del_mins_${deviceId}`) || '0'));
  const [delayedStartSecs, setDelayedStartSecs] = useState(() => Number(localStorage.getItem(`lt_del_secs_${deviceId}`) || '15'));
  const [washDownDuration, setWashDownDuration] = useState(() => Number(localStorage.getItem(`lt_wash_dur_${deviceId}`) || '30'));
  const [washDownResumeNormal, setWashDownResumeNormal] = useState(() => localStorage.getItem(`lt_wd_resume_${deviceId}`) === 'true');
  const [normalRunDaily, setNormalRunDaily] = useState(() => localStorage.getItem(`lt_norm_daily_${deviceId}`) === 'true');
  const [normalRunHours, setNormalRunHours] = useState(() => Number(localStorage.getItem(`lt_norm_hrs_${deviceId}`) || '24'));
  const [normalRunMinutes, setNormalRunMinutes] = useState(() => Number(localStorage.getItem(`lt_norm_mins_${deviceId}`) || '0'));
  const [normalRunVolume, setNormalRunVolume] = useState(() => Number(localStorage.getItem(`lt_norm_vol_${deviceId}`) || '300'));
  const [autoRestartNormal, setAutoRestartNormal] = useState(() => localStorage.getItem(`lt_auto_restart_${deviceId}`) === 'true');
  const [targetDuration, setTargetDuration] = useState(() => Number(localStorage.getItem(`lt_target_dur_${deviceId}`) || '0'));
  const [targetVolume, setTargetVolume] = useState(() => Number(localStorage.getItem(`lt_target_vol_${deviceId}`) || '0'));

  // Listen to global settings_updated events to sync Cloud changes down to local state
  useEffect(() => {
    const handleSettingsUpdate = () => {
      setCloudUsername(localStorage.getItem('lt_cloud_user') || '');
      setCloudApiKey(localStorage.getItem('lt_cloud_key') || '');
      setAlertOffline(localStorage.getItem('lt_alert_offline') !== 'false');
      setGatewayIp(localStorage.getItem('lt_gateway_ip') || '');
      setGatewayId(localStorage.getItem('lt_gateway_id') || '');
      setRefreshInterval(Number(localStorage.getItem('lt_refresh') || '5'));
      setUnitSystem(localStorage.getItem('lt_unit') as 'metric' | 'imperial' || 'imperial');
      setDisplayTz(getDisplayTimeZone());
      setNotificationsEnabled(localStorage.getItem('lt_notifications') === 'true');
      setAlarmSound((localStorage.getItem('lt_alarm_sound') as any) || 'beep');
      setAlarmVolume(Number(localStorage.getItem('lt_alarm_vol') || '1.0'));
      setAlarmRepeatInterval((localStorage.getItem('lt_alarm_repeat') as any) || 'once');
      setNotifyAutoGuard(localStorage.getItem('lt_notif_autoguard') !== 'false');
      setNotifyLowBattery(localStorage.getItem('lt_notif_battery') === 'true');
      setNotifyWatering(localStorage.getItem('lt_notif_watering') === 'true');
      setEnableHistory(localStorage.getItem('lt_enable_history') !== 'false');
      setStoreHistoryCloud(localStorage.getItem('lt_store_history_cloud') === 'true');
      setInputDuration(Number(localStorage.getItem(`lt_input_dur_${deviceId}`) || '15'));
      setInputVolume(Number(localStorage.getItem(`lt_input_vol_${deviceId}`) || '50'));
      setDelayedStartMins(Number(localStorage.getItem(`lt_del_mins_${deviceId}`) || '0'));
      setDelayedStartSecs(Number(localStorage.getItem(`lt_del_secs_${deviceId}`) || '15'));
      setWashDownDuration(Number(localStorage.getItem(`lt_wash_dur_${deviceId}`) || '30'));
      setWashDownResumeNormal(localStorage.getItem(`lt_wd_resume_${deviceId}`) === 'true');
      setNormalRunDaily(localStorage.getItem(`lt_norm_daily_${deviceId}`) === 'true');
      setNormalRunHours(Number(localStorage.getItem(`lt_norm_hrs_${deviceId}`) || '24'));
      setNormalRunMinutes(Number(localStorage.getItem(`lt_norm_mins_${deviceId}`) || '0'));
      setNormalRunVolume(Number(localStorage.getItem(`lt_norm_vol_${deviceId}`) || '300'));
      setAutoRestartNormal(localStorage.getItem(`lt_auto_restart_${deviceId}`) === 'true');
      setTargetDuration(Number(localStorage.getItem(`lt_target_dur_${deviceId}`) || '0'));
      setTargetVolume(Number(localStorage.getItem(`lt_target_vol_${deviceId}`) || '0'));
      setIsCloudPollingActive(localStorage.getItem('lt_is_cloud_polling') === 'true');
      setIsLocalPollingActive(localStorage.getItem('lt_is_local_polling') === 'true');
    };
    
    window.addEventListener('settings_updated', handleSettingsUpdate);
    return () => window.removeEventListener('settings_updated', handleSettingsUpdate);
  }, []);
  // --- App State ---
  const [isFloodAlarmActive, setIsFloodAlarmActive] = useState<boolean>(false);
  const [isCommandLoading, setIsCommandLoading] = useState<boolean | 'start' | 'stop'>(false);
  const lastCommandTimeRef = useRef<number>(0);
  const expectedWateringStateRef = useRef<boolean | null>(null);
  const commandTimeoutRef = useRef<any>(null);
  const previousVolumeRef = useRef<number>(0);
  const washDownTransitionTimeRef = useRef<number | null>(null);
  const lastPollTimeRef = useRef<number>(0);
  const manualStopTriggeredRef = useRef<boolean>(false);

  const [volumeOffset, setVolumeOffset] = useState(0);
  const [durationOffset, setDurationOffset] = useState(0);

  // --- Display Computed Values ---
  const displaySpeed = unitSystem === 'imperial' ? speed * 0.264172 : speed;
  // "Volume Consumed" is the CURRENT session's usage, so show 0 when the valve is idle — mirroring how
  // speed is 0 when not watering (line ~596). The device's `vol` field returns a large/garbage value
  // when closed, which previously rendered as the raw total (e.g. ~95M gallons on a closed valve).
  // (volumeOffset is retained for the existing tare hook but is currently always 0.)
  const sessionVolume = isWatering ? Math.max(0, volume - volumeOffset) : 0;
  const displayVolume = unitSystem === 'imperial' ? sessionVolume * 0.264172 : sessionVolume;
  const displayRemain = Math.max(0, remainDuration + durationOffset);
  const speedUnit = unitSystem === 'imperial' ? 'Gal/min' : 'L/min';
  const volUnit = unitSystem === 'imperial' ? 'Gallons' : 'Liters';

  // --- Historic Stats for Chart ---
  const [flowHistory, setFlowHistory] = useState<FlowData[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // --- PWA Installation Support ---
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(0);

  // Cache settings on change
  useEffect(() => {
    localStorage.setItem(`lt_input_dur_${deviceId}`, inputDuration.toString());
    localStorage.setItem(`lt_input_vol_${deviceId}`, inputVolume.toString());
    localStorage.setItem(`lt_del_mins_${deviceId}`, delayedStartMins.toString());
    localStorage.setItem(`lt_del_secs_${deviceId}`, delayedStartSecs.toString());
    localStorage.setItem(`lt_wash_dur_${deviceId}`, washDownDuration.toString());
    localStorage.setItem(`lt_wd_resume_${deviceId}`, washDownResumeNormal.toString());
    localStorage.setItem(`lt_norm_daily_${deviceId}`, normalRunDaily.toString());
    localStorage.setItem(`lt_norm_hrs_${deviceId}`, normalRunHours.toString());
    localStorage.setItem(`lt_norm_mins_${deviceId}`, normalRunMinutes.toString());
    localStorage.setItem(`lt_norm_vol_${deviceId}`, normalRunVolume.toString());
    localStorage.setItem(`lt_auto_restart_${deviceId}`, autoRestartNormal.toString());
    localStorage.setItem(`lt_target_dur_${deviceId}`, targetDuration.toString());
    localStorage.setItem(`lt_target_vol_${deviceId}`, targetVolume.toString());
  }, [
    deviceId,
    inputDuration, inputVolume, delayedStartMins, delayedStartSecs, washDownDuration,
    normalRunDaily, normalRunHours, normalRunMinutes, normalRunVolume, autoRestartNormal,
    targetDuration, targetVolume
  ]);

  useEffect(() => {
    localStorage.setItem(`lt_notif_battery_${deviceId}`, notifyLowBattery.toString());
    localStorage.setItem(`lt_notif_watering_${deviceId}`, notifyWatering.toString());
  }, [
    deviceId,
    notifyLowBattery, notifyWatering
  ]);

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

  useEffect(() => {
    let unlisten: any;
    const setupFloodListener = async () => {
      try {
        unlisten = await listenTauri('flood-alarm', () => {
          setIsFloodAlarmActive(true);
          playSynthesizedAlarm('siren');
          triggerAlert('CRITICAL', 'Flood Sensor Triggered! Instantly closing the valve.', false);
          if (commandersRef.current.stop) commandersRef.current.stop('limit');
        });
      } catch (e) {
        console.error('Failed to setup flood listener:', e);
      }
    };
    setupFloodListener();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Listen for PWA Install Prompt
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    addLog('info', `PWA Install request: ${outcome}`);
    setDeferredPrompt(null);
    setShowInstallBanner(false);
  };

  // --- Local Safety Guard Auto-Monitoring ---
  useEffect(() => {
    let triggered = false;
    let cause = '';

    if (autoGuardEnabled) {
      if (isBroken) {
        triggered = true;
        cause = 'Gateway reported a broken pipe alarm!';
      } else if (isLeak) {
        triggered = true;
        cause = 'Gateway reported a leak alarm!';
      } else if (displaySpeed > maxFlowRate) {
        // AutoGuard triggers a stop command
        cause = `Flow rate (${displaySpeed.toFixed(1)} ${speedUnit}) exceeded safety limit of ${maxFlowRate} ${speedUnit}!`;
      }
      
      if (triggered && isWatering) {
        if (notifyAutoGuard) triggerAlert('Safety Sentry Triggered', `${cause} Shutting down valve...`);
        executeStopCommand('limit');
      }
    }
  }, [speed, isBroken, isLeak, isWatering, autoGuardEnabled, maxFlowRate, displaySpeed, speedUnit]);

  useEffect(() => {
    if (alertOffline && !isRfLinked && autoGuardEnabled) {
      triggerAlert('Device Offline', 'The LinkTap gateway is offline or disconnected.');
    }
  }, [alertOffline, isRfLinked, autoGuardEnabled]);

  // Low battery trigger
  useEffect(() => {
    if (notifyLowBattery && battery > 0 && battery <= 20) {
      if (!hasNotifiedBattery.current) {
        triggerAlert('Low Battery', `Gateway battery is low (${battery}%).`, true);
        hasNotifiedBattery.current = true;
      }
    } else if (battery > 20) {
      hasNotifiedBattery.current = false;
    }
  }, [battery, notifyLowBattery]);

  // Water start/stop trigger
  const previousWatering = useRef(isWatering);
  useEffect(() => {
    if (notifyWatering && isWatering !== previousWatering.current) {
      if (isWatering) triggerAlert('Water Valve Opened', 'Water flow has started.', true);
      else triggerAlert('Water Valve Closed', 'Water flow has stopped.', true);
    }
    previousWatering.current = isWatering;
  }, [isWatering, notifyWatering]);

  const commandersRef = useRef({ start: null as any, stop: null as any });
  const stateRef = useRef({ isWatering, remainDuration, speed, autoRestartNormal, normalRunDaily, normalRunHours, normalRunMinutes, normalRunVolume, unitSystem, enableHistory, targetVolume, targetDuration });
  useEffect(() => {
    stateRef.current = { isWatering, remainDuration, speed, autoRestartNormal, normalRunDaily, normalRunHours, normalRunMinutes, normalRunVolume, unitSystem, enableHistory, targetVolume, targetDuration };
  }, [isWatering, remainDuration, speed, autoRestartNormal, normalRunDaily, normalRunHours, normalRunMinutes, normalRunVolume, unitSystem, enableHistory, targetVolume, targetDuration]);

  // --- Real-time Polling Logic ---
  useEffect(() => {
    setConnectionStatus('disconnected');

    const poll = async () => {
      if (device.enabled === false || (!isLocalPollingActive && !isCloudPollingActive)) {
        setConnectionStatus('disconnected');
        return;
      }

      // Real network requests
      try {
        setErrorMsg(null);
        let data: any = null;
        let usedCloud = false;

        // 1. Try Local API first (for extremely fast, real-time telemetry)
        if (isLocalPollingActive && gatewayIp) {
           try {
             const localRes = await unifiedFetch(`http://${gatewayIp}/api.shtml`, {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ cmd: 3, gw_id: gatewayId, dev_id: deviceId }),
               timeout: 4000 // Short timeout so it falls back to cloud quickly if off-net
             });
             const rawText = await localRes.text();
             data = JSON.parse(extractJsonFromMaybeHtml(rawText));
             
             if (data.ret !== undefined && data.ret !== 0) {
               throw new Error(`Local API Error Code ${data.ret}`);
             }
           } catch (e) {
             console.warn("Local API poll failed, falling back to Cloud API", e);
             data = null;
           }
        }

        // 2. Fallback to Cloud API (If local fails, e.g., device not on same network)
        // Guard: Cloud API enforces a 30s minimum poll interval — track last call time
        const now = Date.now();
        const lastCloudPoll = (window as any).__lastCloudStatusPoll || 0;
        const cloudCooldownMs = 31000; // 31s to stay safely above the 30s limit
        if (!data && isCloudPollingActive && cloudUsername && cloudApiKey && (now - lastCloudPoll >= cloudCooldownMs)) {
           (window as any).__lastCloudStatusPoll = now;
           usedCloud = true;
           const cloudRes = await unifiedFetch('https://www.link-tap.com/api/getWateringStatus', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ username: cloudUsername, apiKey: cloudApiKey, taplinkerId: deviceId })
           });
           data = await cloudRes.json();
           
           if (data.result === 'error' && data.message && data.message.toLowerCase().includes('error')) {
               data = { status: { watering: null } }; // Mock an idle response
           } else if (data.result === 'error') {
               throw new Error(data.message);
           }
           
           // Fetch battery/signal occasionally (Cloud API only provides this via a separate endpoint)
           if (Date.now() - (window as any).lastCloudDevicePoll > 300000 || !(window as any).lastCloudDevicePoll) {
               try {
                   const devRes = await unifiedFetch('https://www.link-tap.com/api/getAllDevices', {
                       method: 'POST',
                       headers: { 'Content-Type': 'application/json' },
                       body: JSON.stringify({ username: cloudUsername, apiKey: cloudApiKey })
                   });
                   const devData = await devRes.json();
                   if (devData.result === 'ok' && devData.devices) {
                       const tl = devData.devices[0].taplinker.find((t: any) => t.taplinkerId === deviceId) || devData.devices[0].taplinker[0];
                       (window as any).cachedCloudBattery = tl.batteryStatus ? parseInt(String(tl.batteryStatus).replace('%','')) : 100;
                       (window as any).cachedCloudSignal = tl.signal ? parseInt(String(tl.signal).replace('%','')) : 100;
                       (window as any).cachedCloudStatus = tl.status;
                       (window as any).lastCloudDevicePoll = Date.now();
                   }
               } catch (e) { console.warn('Failed to fetch battery/signal', e); }
           }
        }

        if (!data) {
           throw new Error("Polling failed: Ensure Local IP or Cloud Credentials are configured correctly and network is reachable.");
        }

        // 3. Parse format based on source. Cloud responses get folded into the native shape;
        //    local responses already match it.
        if (usedCloud) {
           try {
             data = normalizeCloudStatus(data, {
               battery: (window as any).cachedCloudBattery,
               signal: (window as any).cachedCloudSignal,
               status: (window as any).cachedCloudStatus,
             });
           } catch (e) {
             console.warn('Cloud API parsing issue', e);
           }
        }

        // LinkTap firmware reports battery and signal swapped (both APIs); swap them back.
        swapBatterySignal(data);

        const newIsWatering = coerceWateringBool(data.is_watering);

        if (expectedWateringStateRef.current !== null) {
          if (newIsWatering === expectedWateringStateRef.current) {
            // Physical valve has successfully reached the target state!
            expectedWateringStateRef.current = null;
            setIsCommandLoading(false);
            if (commandTimeoutRef.current) clearTimeout(commandTimeoutRef.current);
          } else {
            const lockDuration = Math.max(30000, effectiveInterval * 1000 + 5000);
            if (Date.now() - lastCommandTimeRef.current < lockDuration) {
              // Still waiting for valve to move. Ignore this old state so UI doesn't flicker!
              setIsRfLinked(data.is_rf_linked ?? true);
              setSignal(data.signal ?? 0);
              setBattery(data.battery ?? 0);
              return;
            } else {
              // Timeout expired, give up and accept current state
              expectedWateringStateRef.current = null;
              setIsCommandLoading(false);
            }
          }
        }
        
        // NOTE: Auto-restart is driven entirely by the app — it only loops while the app is open
        // and polling. TODO(future): move this to a cloud worker so it can watch the device and
        // restart the Normal Run timer even when the app is closed.
        if (stateRef.current.isWatering && !newIsWatering && stateRef.current.autoRestartNormal) {
          const naturalExpiration = stateRef.current.remainDuration <= (effectiveInterval + 15);
          if (manualStopTriggeredRef.current || !naturalExpiration) {
            addLog('info', 'Valve closed manually before timer expired. Auto-restart skipped.');
            manualStopTriggeredRef.current = false;
          } else {
            addLog('info', 'Timer expired. Auto-restart is ON. Restarting Normal Run profile in 5 seconds...');
            setTimeout(() => {
               let vol = stateRef.current.normalRunVolume;
               if (stateRef.current.unitSystem === 'imperial') vol = vol / 0.264172;
               const durationMins = stateRef.current.normalRunDaily ? 1439 : (stateRef.current.normalRunHours * 60) + stateRef.current.normalRunMinutes;
               if (commandersRef.current.start) commandersRef.current.start(durationMins, vol);
            }, 5000);
          }
        }
        
        if (stateRef.current.isWatering && !newIsWatering) {
            setVolumeOffset(0);
            setDurationOffset(0);
        }

        setIsRfLinked(data.is_rf_linked ?? true);

        setIsBroken(data.is_broken ?? false);
        setIsLeak(data.is_leak ?? false);
        setIsClog(data.is_clog ?? false);
        setSignal(data.signal ?? 0);
        setBattery(data.battery ?? 0);
        setIsWatering(newIsWatering);
        setSpeed(newIsWatering ? Number(data.speed ?? data.vel ?? 0) : 0);

        // If targetVolume is 0 (app launched mid-cycle), try to extract it from the API
        const apiTargetVol = pickTargetVolume(data);
        if (apiTargetVol > 0 && stateRef.current.targetVolume === 0) setTargetVolume(apiTargetVol);

        const apiTargetDur = pickTargetDuration(data);
        if (apiTargetDur > 0 && stateRef.current.targetDuration === 0) setTargetDuration(apiTargetDur * 60); // assume minutes from API

        // If we are using Local API (meaning usedCloud is false) and we just discovered watering is active, 
        // the Local API often does not provide the duration/volume limits.
        // We can asynchronously poll the Cloud API specifically for this limit data to populate the UI.
        if (newIsWatering && stateRef.current.targetVolume === 0 && stateRef.current.targetDuration === 0 && !usedCloud && isCloudPollingActive && cloudUsername && cloudApiKey) {
            if (!(window as any).fetchingLimits) {
                (window as any).fetchingLimits = true;
                unifiedFetch('https://www.link-tap.com/api/getWateringStatus', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: cloudUsername, apiKey: cloudApiKey, taplinkerId: deviceId })
                }).then(r => r.json()).then(cloudData => {
                    (window as any).fetchingLimits = false;
                    if (cloudData.result !== 'error') {
                        const st = cloudData.status || cloudData;
                        const cVol = Number(st.limit || st.target_vol || (st.watering ? st.watering.vol : 0) || 0);
                        const cDur = Number(st.totalDuration || st.total || (st.watering ? st.watering.duration : 0) || 0);
                        if (cVol > 0 && stateRef.current.targetVolume === 0) setTargetVolume(cVol);
                        if (cDur > 0 && stateRef.current.targetDuration === 0) setTargetDuration(cDur * 60);
                    }
                }).catch(e => {
                    (window as any).fetchingLimits = false;
                    console.warn('Background cloud fetch for limits failed', e);
                });
            }
        }

        const currentVolume = Number(data.volume ?? data.vol ?? 0);

        // Software-enforced volume cutoff
        // LinkTap hardware often ignores volume limits passed to cmd: 6, so we must enforce it here!
        if (newIsWatering && targetVolume > 0 && currentVolume > 0) {
           if (currentVolume >= targetVolume) {
              if (commandersRef.current.stop && expectedWateringStateRef.current !== false) {
                 addLog('success', `Target volume limit reached. Sending software-enforced stop command.`);
                 commandersRef.current.stop('limit');
                 expectedWateringStateRef.current = false;
                 setIsCommandLoading('stop');
              }
           }
        }

        if (stateRef.current.enableHistory) {
          const delta = currentVolume < previousVolumeRef.current 
              ? currentVolume // cycle restarted, add new volume
              : currentVolume - previousVolumeRef.current;
          
          if (delta > 0) {
            const now = new Date();
            now.setMinutes(0, 0, 0); // floor to hour
            const bucket = now.toISOString();
            setUsageHistory(prev => ({ ...prev, [bucket]: (prev[bucket] || 0) + delta }));
          }
        }
        previousVolumeRef.current = currentVolume;
        setVolume(currentVolume);

        if (washDownTransitionTimeRef.current) {
          const remainingMs = washDownTransitionTimeRef.current - Date.now();
          if (remainingMs <= 0) {
            // Washdown timer expired! Reprogram to Normal Cycle!
            addLog('info', 'Washdown complete! Resuming Normal Run profile without shutting off valve...');
            washDownTransitionTimeRef.current = null;
            let vol = stateRef.current.normalRunVolume;
            if (stateRef.current.unitSystem === 'imperial') vol = vol / 0.264172;
            const durationMins = stateRef.current.normalRunDaily ? 1439 : (stateRef.current.normalRunHours * 60) + stateRef.current.normalRunMinutes;
            if (commandersRef.current.start) commandersRef.current.start(durationMins, vol);
          } else {
            // Override UI remain duration so it shows the exact Washdown time instead of Washdown + Buffer
            data.remain_duration = Math.round(remainingMs / 1000);
          }
        }

        setRemainDuration(Number(data.remain_duration ?? 0));
        
        setConnectionStatus('connected');
        setLastUpdated(Date.now());

        setFlowHistory((prev) => {
          const next = [...prev, { ts: Date.now(), speed: Number(data.speed) }];
          return next.slice(-20);
        });

      } catch (err: any) {
        setConnectionStatus('disconnected');
        const env = isTauriEnv() ? '(Native Proxy)' : '(Browser)';
        const errMsg = err instanceof Error ? err.message : (err && err.message ? err.message : String(err));
        setErrorMsg(`Failed to connect to gateway ${env}: ${errMsg}`);
      } finally {
        lastPollTimeRef.current = Date.now();
      }
    };

    const timeSinceLastPoll = Date.now() - lastPollTimeRef.current;
    if (timeSinceLastPoll >= pollInterval * 1000 - 1000 || Date.now() - manualRefresh < 1000 || lastPollTimeRef.current === 0) {
      poll();
    }
    
    const timer = setInterval(poll, pollInterval * 1000);
    return () => clearInterval(timer);
  }, [gatewayIp, gatewayId, deviceId, isCloudPollingActive, isLocalPollingActive, refreshInterval, effectiveInterval, pollInterval, manualRefresh, cloudUsername, cloudApiKey, device.enabled]);

  // --- API Action Commanders ---
  
  // cmd 6: Start watering
  const executeStartCommandRaw = async (durationMins: number, volumeLimitLiters: number) => {
    setTargetDuration(durationMins * 60);
    setTargetVolume(volumeLimitLiters);
    setVolume(0);
    setVolumeOffset(0);
    setDurationOffset(0);

    // Optimistically lock the buttons so they react immediately
    lastCommandTimeRef.current = Date.now();
    expectedWateringStateRef.current = true;
    if (commandTimeoutRef.current) clearTimeout(commandTimeoutRef.current);
    setIsCommandLoading('start');

    addLog('info', `Sending API command: START watering. Duration: ${durationMins}m, Limit: ${volumeLimitLiters}L`);

    if (commandTimeoutRef.current) clearTimeout(commandTimeoutRef.current);
    setIsCommandLoading('start');
    try {
      setErrorMsg(null);
      let success = false;
      let usedLocal = false;

      // 1. Always attempt Cloud API first for maximum safety (hardware volume cutoffs)
      if (isCloudPollingActive && cloudUsername && cloudApiKey) {
        try {
          const payload: any = {
            username: cloudUsername,
            apiKey: cloudApiKey,
            gatewayId,
            taplinkerId: deviceId,
            action: true,
            duration: Math.min(1439, durationMins), // Cloud API strict max is 1439 mins (23h 59m)
            autoBack: true
          };
          if (volumeLimitLiters > 0) {
            payload.vol = Math.round(volumeLimitLiters);
          }

          const cloudRes = await unifiedFetch('https://www.link-tap.com/api/activateInstantMode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          
          if (!cloudRes.ok) throw new Error(`Cloud HTTP Error ${cloudRes.status}`);
          const cloudData = await cloudRes.json();
          if (cloudData.result === 'error') throw new Error(cloudData.message);
          
          success = true;
          addLog('success', 'Cloud API Start command received by Gateway.');
        } catch (e: any) {
          addLog('warning', `Cloud API Start failed: ${e.message}. Falling back to Local API...`);
        }
      }

      // 2. Fallback to Local API
      if (!success) {
        if (!gatewayIp) throw new Error("Cloud API failed and no Local Gateway IP configured for fallback.");
        
        const localRes = await unifiedFetch(`http://${gatewayIp}/api.shtml`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cmd: 6,
            gw_id: gatewayId,
            dev_id: deviceId,
            duration: Math.round(durationMins * 60), // Local API expects SECONDS
            volume_limit: Math.round(volumeLimitLiters), // Local API expects 'volume_limit' not 'vol'
            vol: Math.round(volumeLimitLiters) // Fallback just in case
          }),
        });
        
        if (!localRes.ok) throw new Error(`Local HTTP Error ${localRes.status}`);
        // Local API usually returns JSON or HTML. Assume success if reached.
        success = true;
        usedLocal = true;
        addLog('success', 'Local API Start command received by Gateway.');
      }

      // 3. UI State Management
      if (usedLocal && volumeLimitLiters > 0) {
        setIsSoftwareCutoffActive(true);
      } else {
        setIsSoftwareCutoffActive(false);
      }
      const lockDuration = Math.max(30000, effectiveInterval * 1000 + 5000);
      commandTimeoutRef.current = setTimeout(() => {
         if (expectedWateringStateRef.current !== null) {
             expectedWateringStateRef.current = null;
             setIsCommandLoading(false);
         }
      }, lockDuration);
      
      const refreshDelay = 2500;
      setTimeout(() => setManualRefresh(Date.now()), refreshDelay); // Speed up next poll to detect change faster
    } catch (err: any) {
      addLog('danger', `API Start command failed: ${err.message}`);
      setErrorMsg(err.message);
      expectedWateringStateRef.current = null;
      setIsCommandLoading(false);
    }
  };

  // Automation (auto-restart, washdown) uses the raw command; user buttons use the gated wrapper.
  commandersRef.current.start = executeStartCommandRaw;

  // Monitor-only users can view but not operate the valve.
  const executeStartCommand = (durationMins: number, volumeLimitLiters: number) => {
    if (!canControl) { addLog('warning', '🔒 Monitor-only access — controls are disabled for your account.'); return; }
    executeStartCommandRaw(durationMins, volumeLimitLiters);
  };

  // cmd 7: Stop watering (Emergency Button)
  const executeStopCommand = async (reason: 'manual' | 'limit' = 'manual') => {
    if (reason === 'manual' && !canControl) { addLog('warning', '🔒 Monitor-only access — controls are disabled for your account.'); return; }
    addLog('warning', reason === 'limit' ? `⚠️ Valve turned off due to limit reached.` : `⚠️ Manual valve turn off initiated.`);

    lastCommandTimeRef.current = Date.now();
    expectedWateringStateRef.current = false;
    washDownTransitionTimeRef.current = null;
    
    if (commandTimeoutRef.current) clearTimeout(commandTimeoutRef.current);
    setIsCommandLoading('stop');
    try {
      setErrorMsg(null);
      let success = false;

      // 1. Attempt Cloud API first
      if (cloudUsername && cloudApiKey) {
        try {
          const cloudRes = await unifiedFetch('https://www.link-tap.com/api/activateInstantMode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: cloudUsername,
              apiKey: cloudApiKey,
              gatewayId,
              taplinkerId: deviceId,
              action: false,
              duration: 0,
              autoBack: true
            }),
          });
          if (!cloudRes.ok) throw new Error(`Cloud HTTP Error ${cloudRes.status}`);
          const cloudData = await cloudRes.json();
          if (cloudData.result === 'error') throw new Error(cloudData.message);
          
          success = true;
          addLog('success', 'Cloud API Stop command received by Gateway.');
        } catch (e: any) {
          addLog('warning', `Cloud API Stop failed: ${e.message}. Falling back to Local API...`);
        }
      }

      // 2. Fallback to Local API
      if (!success) {
        if (!gatewayIp) throw new Error("Cloud API failed and no Local Gateway IP configured for fallback.");
        const localRes = await unifiedFetch(`http://${gatewayIp}/api.shtml`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cmd: 7,
            gw_id: gatewayId,
            dev_id: deviceId,
          }),
        });
        
        if (!localRes.ok) throw new Error(`Local HTTP Error ${localRes.status}`);
        success = true;
        addLog('success', 'Local API Stop command received by Gateway.');
      }

      // 3. UI State Management
      setIsSoftwareCutoffActive(false);
      
      const lockDuration = Math.max(30000, effectiveInterval * 1000 + 5000);
      commandTimeoutRef.current = setTimeout(() => {
         if (expectedWateringStateRef.current !== null) {
             expectedWateringStateRef.current = null;
             setIsCommandLoading(false);
         }
      }, lockDuration);
      
      const refreshDelay = 2500;
      setTimeout(() => setManualRefresh(Date.now()), refreshDelay); // Speed up next poll to detect change faster
    } catch (err: any) {
      addLog('danger', `API Stop command failed: ${err.message}`);
      setErrorMsg(err.message);
      expectedWateringStateRef.current = null;
      setIsCommandLoading(false);
    }
  };

  commandersRef.current.stop = executeStopCommand;

  // --- HTML5 Canvas History Graph Rendering ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawFlowChart(canvas, flowHistory, unitSystem);
  }, [flowHistory]);

  const clearAlarms = () => {
    setIsBroken(false);
    setIsLeak(false);

    setIsClog(false);
    setBattery(95);
    addLog('success', '✅ All mock alarms cleared and safety status reset.');
  };

  return (
    <div style={{ flex: 1, paddingBottom: '40px' }}>
      {/* Active Alarm Banner */}
      {activeAlarmSound && alarmRepeatInterval !== 'once' && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, background: 'var(--accent-red)', color: '#fff', padding: '15px', textAlign: 'center', zIndex: 9999, fontWeight: 800, cursor: 'pointer', boxShadow: '0 4px 20px rgba(239, 68, 68, 0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px' }} onClick={() => setActiveAlarmSound(null)}>
          <span style={{ fontSize: '1.4rem' }}>🚨</span>
          <span style={{ fontSize: '1.1rem', letterSpacing: '1px' }}>ALARM ACTIVE - CLICK ANYWHERE TO ACKNOWLEDGE & MUTE</span>
          <span style={{ fontSize: '1.4rem' }}>🚨</span>
        </div>
      )}
      
      
      {/* Click anywhere handler for alarm */}
      {activeAlarmSound && alarmRepeatInterval !== 'once' && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9997, cursor: 'pointer' }} onClick={() => setActiveAlarmSound(null)} />
      )}

      {/* Top Header */}
      <header style={{
        background: 'linear-gradient(180deg, var(--bg-secondary) 0%, rgba(4,8,20,0) 100%)',
        padding: '24px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.03)',
        marginBottom: '30px'
      }}>
        <div style={{
          maxWidth: '900px',
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <h2 style={{ margin: 0, color: 'var(--accent-cyan)' }}>{device.name || 'LinkTap Valve'}</h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>

            {/* Battery Indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.03)', padding: '6px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={battery < 15 ? 'var(--accent-red)' : 'var(--accent-emerald)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="16" height="10" rx="2" ry="2"></rect>
                <line x1="22" y1="11" x2="22" y2="13"></line>
              </svg>
              <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: battery < 15 ? 'var(--accent-red)' : '#fff' }}>{battery}%</span>
            </div>

            {/* Signal Strength */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.03)', padding: '6px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
                <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
                <path d="M8.58 16.14a7 7 0 0 1 6.83 0"></path>
                <line x1="12" y1="20" x2="12.01" y2="20"></line>
              </svg>
              <span style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>{isRfLinked ? `LINK OK (${signal}%)` : 'LINK STUCK'}</span>
            </div>

            {/* Connection badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.03)', padding: '6px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <span className={`status-dot ${connectionStatus === 'connected' ? 'online' : connectionStatus}`}></span>
              <span style={{ fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>
                {connectionStatus === 'connected' ?
                   (isCloudPollingActive && isLocalPollingActive ? 'CLOUD & LOCAL CONNECTED' :
                    isCloudPollingActive ? 'CLOUD ONLY CONNECTED' :
                    isLocalPollingActive ? 'LOCAL ONLY CONNECTED' : 'CONNECTED') :
                 connectionStatus === 'connecting' ? 'CONNECTING...' : 'DISCONNECTED'}
              </span>
            </div>

          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="main-layout">
        
        {/* Left Column: Flow Metrics & Controls */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* PWA Install Banner */}
          {showInstallBanner && (
            <div className="install-banner">
              <div>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 'bold', marginBottom: '4px' }}>Install PWA App</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Add Boat & RV Guardian to your home screen for quick offline boat monitoring.</p>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={handleInstallClick} className="btn-primary" style={{ padding: '8px 16px', fontSize: '0.8rem' }}>Install</button>
                <button onClick={() => setShowInstallBanner(false)} className="btn-secondary" style={{ padding: '8px 16px', fontSize: '0.8rem' }}>Dismiss</button>
              </div>
            </div>
          )}

          {/* Alarm Banner if leak/burst is active */}
          {(isBroken || isLeak || displaySpeed > maxFlowRate) && (
            <div className="glass-card danger" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--accent-red)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 0 10px rgba(239, 68, 68, 0.8)'
                }}>
                  <span style={{ fontWeight: 'bold', fontSize: '1.2rem', color: '#fff' }}>!</span>
                </div>
                <div>
                  <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#ff8b8b' }}>CRITICAL WATER ANOMALY</h2>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {isBroken && '🚨 PIPE BREAK ALARM: Critical rupture flagged by flow sensor.'}
                    {!isBroken && displaySpeed > maxFlowRate && `🚨 EXPENDITURE LIMIT: Flow rate (${displaySpeed.toFixed(1)} ${speedUnit}) exceeds local safety threshold (${maxFlowRate} ${speedUnit}).`}
                    {isLeak && !isBroken && '⚠️ LEAK ALERT: Small trickle flow detected without schedule.'}

                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Flow Speed & Statistics Card */}
          <div className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Real-Time Flow Analysis</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Data refreshed every {isLocalPollingActive && gatewayIp ? `${effectiveInterval}s (local)` : '31s (cloud)'} • Last update: {lastUpdated ? formatTime(lastUpdated) : 'Never'}</p>
                {!canControl && (
                  <p style={{ fontSize: '0.78rem', color: '#fde68a', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: '6px', padding: '6px 10px', marginTop: '6px', display: 'inline-block' }}>
                    🔒 Monitor-only access — you can view status but not operate this device.
                  </p>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>VALVE STATUS</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                  <span className={`status-dot ${isWatering ? 'online' : 'offline'}`}></span>
                  <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: isWatering ? 'var(--accent-emerald)' : 'var(--text-secondary)' }}>
                    {isWatering ? 'OPEN (WATERING)' : 'CLOSED (SECURE)'}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {/* Giant Water Meter */}
              <div style={{ background: 'rgba(0,0,0,0.2)', padding: '24px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.02)', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', position: 'relative', zIndex: 10 }}>
                  
                  {/* Flow Rate */}
                  <div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current Speed</span>
                    <div style={{ fontSize: '2.5rem', fontWeight: 800, color: displaySpeed > maxFlowRate ? 'var(--accent-red)' : 'var(--accent-cyan)', margin: '4px 0', textShadow: displaySpeed > maxFlowRate ? '0 0 15px rgba(239,68,68,0.3)' : '0 0 15px rgba(0,242,254,0.3)' }}>
                      {displaySpeed.toFixed(1)}
                      <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-secondary)', marginLeft: '4px' }}>{speedUnit}</span>
                    </div>
                  </div>

                  {/* Volume Consumed */}
                  <div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Volume Consumed</span>
                    <div style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--accent-blue)', margin: '4px 0', textShadow: '0 0 15px rgba(56,189,248,0.3)' }}>
                      {displayVolume.toFixed(2)}
                      <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-secondary)', marginLeft: '4px' }}>{volUnit}</span>
                    </div>
                  </div>

                </div>

                <div style={{ marginTop: '16px', fontSize: '0.8rem', color: 'var(--text-muted)', position: 'relative', zIndex: 10 }}>
                  {isWatering ? `${(remainDuration / 60).toFixed(1)} mins remaining` : 'Waiting for flow...'}
                </div>
                
                {/* Flow Wave Animation */}
                <div className="wave-container">
                  <div className="wave wave-bg" style={{ animationDuration: speed > 15 ? '3s' : speed > 5 ? '6s' : '12s' }}></div>
                  <div className="wave wave-fg" style={{ animationDuration: speed > 15 ? '1.5s' : speed > 5 ? '3s' : '6s' }}></div>
                </div>
              </div>

              {/* Auxiliary Quick Stats */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                {(isClog || isBroken || isLeak) && (
                  <div style={{ borderLeft: '3px solid var(--accent-red)', paddingLeft: '12px' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>System Alarms</span>
                    <div style={{ marginTop: '4px' }}>
                      <button 
                        onClick={() => {
                          clearAlarms();
                          setActiveAlarmSound(null);
                        }} 
                        style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid var(--accent-red)', color: 'var(--accent-red)', padding: '4px 12px', borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 'bold' }}
                      >
                        Acknowledge & Reset
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

{/* Chart moved to Right Column */}

          {/* Active Job Progress */}
          {isWatering && (
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', border: '1px solid rgba(16, 185, 129, 0.4)', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent-emerald)', display: 'flex', justifyContent: 'space-between' }}>
                <span>Active Run Progress {targetVolume === 0 && targetDuration === 0 && '(Started Externally)'}</span>
                <span className="status-dot connected" style={{ marginRight: 0 }}></span>
              </h3>
              
              {isSoftwareCutoffActive && targetVolume > 0 && (
                <div style={{ padding: '10px', background: 'rgba(185, 28, 28, 0.15)', borderLeft: '3px solid var(--accent-red)', borderRadius: '4px', fontSize: '0.85rem', color: '#fca5a5', display: 'flex', alignItems: 'flex-start', gap: '8px', lineHeight: '1.4', marginBottom: '8px' }}>
                  <span style={{ fontSize: '1.1rem' }}>⚠️</span>
                  <div>
                    Your device is in local API only access mode, if you close the app the volume limit will not turn off. The reliability of this mode is limited.
                  </div>
                </div>
              )}
              
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '6px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Time Remaining</span>
                  <span style={{ fontWeight: 'bold' }}>{displayRemain > 0 ? `${Math.floor(displayRemain / 3600)}h ${Math.floor((displayRemain % 3600) / 60)}m` : 'Unknown / Infinite'}</span>
                </div>
                {targetDuration > 0 && (
                  <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, Math.max(0, 100 - (remainDuration / Math.max(1, targetDuration)) * 100))}%`, height: '100%', background: 'var(--accent-emerald)', transition: 'width 1s linear' }}></div>
                  </div>
                )}
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '6px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Volume Consumed</span>
                  <span style={{ fontWeight: 'bold' }}>
                    {displayVolume.toFixed(1)} {volUnit}
                    {targetVolume > 0 && ` / ${(unitSystem === 'imperial' ? targetVolume * 0.264172 : targetVolume).toFixed(1)} ${volUnit} Limit`}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '6px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Volume Remaining</span>
                  <span style={{ fontWeight: 'bold' }}>
                     {targetVolume > 0 ? `${Math.max(0, (unitSystem === 'imperial' ? targetVolume * 0.264172 : targetVolume) - displayVolume).toFixed(1)} ${volUnit}` : 'Unknown / Infinite'}
                  </span>
                </div>
                {targetVolume > 0 && (
                  <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, Math.max(0, (displayVolume / Math.max(1, unitSystem === 'imperial' ? targetVolume * 0.264172 : targetVolume)) * 100))}%`, height: '100%', background: 'var(--accent-blue)', transition: 'width 1s linear' }}></div>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <button 
                  className="btn-secondary" 
                  onClick={() => executeStartCommand(targetDuration / 60, targetVolume)}
                  disabled={!!isCommandLoading}
                  style={{ flex: 1, padding: '8px', fontSize: '0.8rem' }}
                >
                  ⏱️ Reset Timer & Volume
                </button>
              </div>
            </div>
          )}



          {/* Main Controls Console */}
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* Normal Run Mode */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent-emerald)', marginBottom: '12px' }}>Normal Run Mode</h3>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.15)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.2)', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Configured Target Time:</span>
                  <span style={{ fontWeight: 'bold' }}>{normalRunDaily ? 'Daily (23h 59m)' : `${normalRunHours} hr ${normalRunMinutes} min`}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Configured Volume Limit:</span>
                  <span style={{ fontWeight: 'bold' }}>{normalRunVolume} {volUnit}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Auto Restart (Loop):</span>
                  <button
                    onClick={() => setShowAutoRestartModal(true)}
                    title="Tap to change"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', padding: '3px 10px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', color: autoRestartNormal ? 'var(--accent-cyan)' : 'var(--text-muted)' }}
                  >{autoRestartNormal ? 'ENABLED' : 'DISABLED'} ▾</button>
                </div>
              </div>
              <button
                disabled={isWatering || !!isCommandLoading}
                onClick={() => {
                   let vol = normalRunVolume;
                   if (unitSystem === 'imperial') vol = vol / 0.264172; // Convert to liters for API
                   const durationMins = normalRunDaily ? 1439 : (normalRunHours * 60) + normalRunMinutes;
                   executeStartCommand(durationMins, vol);
                }}
                className="btn-primary"
                style={{ marginTop: '12px', width: '100%', padding: '12px', fontSize: '0.95rem', background: isWatering ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #10b981, #059669)', color: isWatering ? '#888' : '#fff' }}
              >
                {isCommandLoading === 'start' ? '⏳ STARTING...' : (isCommandLoading === 'stop' ? '⏳ STOPPING...' : (isWatering ? '🛑 STOP CURRENT CYCLE FIRST' : '▶ START NORMAL RUN'))}
              </button>
            </div>

            <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)' }}></div>

            {/* Mode 2: Wash Down Mode */}
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent-blue)', marginBottom: '12px' }}>Wash Down Mode</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>Unlimited water flow for a set duration.</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                 <div>
                   <label className="form-label">Duration</label>
                   <select className="form-input" value={washDownDuration} onChange={(e) => setWashDownDuration(Number(e.target.value))}>
                     <option value={5}>5 Minutes</option>
                     <option value={15}>15 Minutes</option>
                     <option value={30}>30 Minutes</option>
                     <option value={60}>60 Minutes</option>
                     <option value={120}>2 Hours</option>
                     <option value={240}>4 Hours</option>
                     <option value={480}>8 Hours</option>
                     <option value={720}>12 Hours</option>
                     <option value={1440}>24 Hours</option>
                   </select>
                   <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', fontSize: '0.85rem', cursor: 'pointer' }}>
                     <input type="checkbox" checked={washDownResumeNormal} onChange={(e) => setWashDownResumeNormal(e.target.checked)} />
                     Start 'Normal Run' when timer expires
                   </label>
                 </div>
                 <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                   <button
                     disabled={!!isCommandLoading}
                     onClick={() => {
                        if (washDownResumeNormal) {
                           const transitionMs = Date.now() + (washDownDuration * 60000);
                           washDownTransitionTimeRef.current = transitionMs;
                           // Send hardware duration of Washdown + 5 minutes buffer so it doesn't turn off.
                           // Our software polling loop will catch the transition and reprogram it!
                           executeStartCommand(washDownDuration + 5, 0);
                        } else {
                           washDownTransitionTimeRef.current = null;
                           executeStartCommand(washDownDuration, 99999);
                        }
                     }}
                     className="btn-primary"
                     style={{ width: '100%', padding: '12px', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', color: '#fff', fontSize: '0.95rem' }}
                   >
                     {isCommandLoading === 'start' ? '⏳ STARTING...' : (isCommandLoading === 'stop' ? '⏳ STOPPING...' : (isWatering ? ((targetVolume >= 9999 || washDownTransitionTimeRef.current !== null) ? '🌊 RESTART WASH DOWN' : '🌊 OVERRIDE WITH WASH DOWN') : '🌊 START WASH DOWN'))}
                   </button>
                 </div>
              </div>
            </div>

            <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)' }}></div>

            {/* Mode 1: Fill a Tank */}
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: '12px' }}>Fill a Tank / Custom Run Time</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                <div>
                  <label className="form-label">Volume ({volUnit})</label>
                  <input type="number" min="1" className="form-input" value={inputVolume} onChange={(e) => setInputVolume(Math.max(1, Number(e.target.value)))} />
                </div>
                <div>
                  <label className="form-label">Max Duration (Mins)</label>
                  <input type="number" min="1" className="form-input" value={inputDuration} onChange={(e) => setInputDuration(Math.max(1, Number(e.target.value)))} />
                </div>
                <div>
                  <label className="form-label">Delay Start (Min / Sec)</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <input type="number" min="0" className="form-input" value={delayedStartMins} onChange={(e) => setDelayedStartMins(Math.max(0, Number(e.target.value)))} placeholder="Min" />
                    <input type="number" min="0" max="59" className="form-input" value={delayedStartSecs} onChange={(e) => setDelayedStartSecs(Math.max(0, Number(e.target.value)))} placeholder="Sec" />
                  </div>
                </div>
              </div>
              <button
                disabled={isWatering || !!isCommandLoading}
                onClick={() => {
                   let vol = inputVolume;
                   if (unitSystem === 'imperial') vol = vol / 0.264172; // Convert back to liters for API
                   const totalDelayMs = (delayedStartMins * 60000) + (delayedStartSecs * 1000);
                   if (totalDelayMs > 0) {
                      addLog('info', `Delayed start activated. Tank fill will start in ${delayedStartMins}m ${delayedStartSecs}s.`);
                      setTimeout(() => executeStartCommand(inputDuration, vol), totalDelayMs);
                   } else {
                      executeStartCommand(inputDuration, vol);
                   }
                }}
                className="btn-primary"
                style={{ marginTop: '12px', width: '100%', padding: '12px', fontSize: '0.95rem', background: isWatering ? 'rgba(255,255,255,0.1)' : undefined, color: isWatering ? '#888' : '#fff' }}
              >
                {isCommandLoading === 'start' ? '⏳ STARTING...' : (isCommandLoading === 'stop' ? '⏳ STOPPING...' : (isWatering ? '🛑 STOP CURRENT CYCLE FIRST' : '💧 START TANK FILL'))}
              </button>
            </div>

            <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)' }}></div>

            {/* Instant Off Button */}
            <div>
              <button
                disabled={!!isCommandLoading}
                onClick={() => executeStopCommand('manual')}
                className="btn-danger-glow"
                style={{ width: '100%', padding: '16px 20px', fontSize: '1.1rem' }}
              >
                🛑 {isCommandLoading === 'stop' ? 'STOPPING...' : 'Stop Water (Close Valve)'}
              </button>
            </div>
          </div>
        </section>

        {/* Right Column: Daily Monitoring */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Flow History Line Chart */}
          <div className="glass-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '220px' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '16px' }}>Flow Timeline Logs</h3>
            <canvas ref={canvasRef} style={{ width: '100%', height: '180px', background: 'rgba(0,0,0,0.15)', borderRadius: '8px', flex: 1 }}></canvas>
          </div>

          {/* Activity Event Logs */}
          <div className="glass-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '220px' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '12px' }}>Event Sentry Log</h3>
            <div style={{
              flex: 1,
              overflowY: 'auto',
              background: 'rgba(0,0,0,0.2)',
              borderRadius: '8px',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              maxHeight: '220px'
            }}>
              {logs.map((log, index) => (
                <div key={index} style={{
                  fontSize: '0.75rem',
                  lineHeight: '1.3',
                  paddingBottom: '6px',
                  borderBottom: '1px solid rgba(255,255,255,0.02)',
                  color: log.type === 'danger' ? '#ff8b8b' : log.type === 'warning' ? '#fde68a' : log.type === 'success' ? '#a7f3d0' : 'var(--text-secondary)'
                }}>
                  <span style={{ color: 'var(--text-muted)', marginRight: '6px', fontFamily: 'monospace' }}>[{formatTime(log.ts)}]</span>
                  {log.message}
                </div>
              ))}
            </div>
          </div>
          
        </section>
      </main>

      {/* View Usage Statistics Button */}
      <button 
        className="btn-secondary"
        onClick={() => setShowHistoryModal(true)}
        style={{ width: '100%', padding: '14px', margin: '24px auto', maxWidth: '800px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', fontSize: '1rem', fontWeight: 600, border: '1px solid rgba(0, 242, 254, 0.3)' }}
      >
        📊 View Usage Statistics
      </button>

      {/* Connection Failure banner */}
      {errorMsg && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          left: '20px',
          background: 'rgba(239, 68, 68, 0.95)',
          color: '#fff',
          padding: '16px 24px',
          borderRadius: '8px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          zIndex: 9999,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="btn-secondary" style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none' }}>Dismiss</button>
        </div>
      )}

      {/* Version Badge */}
      <div style={{ position: 'fixed', bottom: '10px', right: '12px', fontSize: '0.65rem', color: 'rgba(255,255,255,0.2)', pointerEvents: 'none', userSelect: 'none', zIndex: 1 }}>
        v{APP_VERSION}
      </div>
      {/* Flood Alarm Modal */}
      {isFloodAlarmActive && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(239, 68, 68, 0.95)', backdropFilter: 'blur(10px)', zIndex: 10000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', color: '#fff', textAlign: 'center' }}>
          <div style={{ fontSize: '4rem', marginBottom: '20px', animation: 'pulse 1s infinite alternate' }}>🌊 🚨 🌊</div>
          <h2 style={{ fontSize: '2.5rem', margin: '0 0 20px 0', textTransform: 'uppercase', fontWeight: 900 }}>Flood Detected!</h2>
          <p style={{ fontSize: '1.2rem', maxWidth: '400px', lineHeight: 1.5, marginBottom: '40px' }}>
            A high water level was detected by the local flood sensor. The smart valve has been instructed to instantly stop water flow.
          </p>
          <button 
            className="btn-primary" 
            style={{ padding: '16px 32px', fontSize: '1.2rem', background: '#fff', color: '#e53e3e', fontWeight: 'bold' }}
            onClick={() => {
              setIsFloodAlarmActive(false);
              setActiveAlarmSound(null);
            }}
          >
            Acknowledge & Silence Alarm
          </button>
        </div>
      )}

      {/* Usage History Modal */}
      {showAutoRestartModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(4,8,20,0.85)', backdropFilter: 'blur(8px)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative' }}>
            <button onClick={() => setShowAutoRestartModal(false)} className="btn-secondary" style={{ position: 'absolute', top: '20px', right: '20px', padding: '6px 10px', fontSize: '1rem', zIndex: 10 }}>✕</button>

            <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--accent-cyan)', marginBottom: '4px' }}>🔁 Auto Restart (Loop)</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>When the Normal Run profile expires naturally, automatically restart it after a few seconds.</p>

            {!canControl && (
              <div style={{ padding: '10px', background: 'rgba(255,200,0,0.1)', borderLeft: '3px solid #fde68a', borderRadius: '4px', fontSize: '0.75rem', color: '#fde68a' }}>
                You have monitor-only access and cannot change this setting.
              </div>
            )}

            {autoRestartNormal && (
              <div style={{ padding: '10px', background: 'rgba(255,200,0,0.1)', borderLeft: '3px solid #fde68a', borderRadius: '4px', fontSize: '0.75rem', color: '#fde68a' }}>
                <strong>⚠️ Keep the app open.</strong> The restart is triggered by this app, so it must stay open and connected for the loop to continue. If the app is closed when a cycle ends, it won't restart.
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                disabled={!canControl}
                onClick={() => { setAutoRestartNormal(false); setShowAutoRestartModal(false); }}
                className="btn-secondary"
                style={{ flex: 1, padding: '12px', fontSize: '0.9rem', fontWeight: 700, opacity: canControl ? 1 : 0.5, background: !autoRestartNormal ? 'var(--text-muted)' : 'rgba(255,255,255,0.05)', color: !autoRestartNormal ? '#000' : 'var(--text-primary)' }}
              >DISABLED</button>
              <button
                disabled={!canControl}
                onClick={() => { setAutoRestartNormal(true); setShowAutoRestartModal(false); }}
                className="btn-secondary"
                style={{ flex: 1, padding: '12px', fontSize: '0.9rem', fontWeight: 700, opacity: canControl ? 1 : 0.5, background: autoRestartNormal ? 'var(--accent-cyan)' : 'rgba(255,255,255,0.05)', color: autoRestartNormal ? '#000' : 'var(--text-primary)' }}
              >ENABLED</button>
            </div>
          </div>
        </div>
      )}

      {showHistoryModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(4,8,20,0.85)', backdropFilter: 'blur(8px)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
           <div className="glass-card" style={{ width: '100%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative' }}>
              <button onClick={() => setShowHistoryModal(false)} className="btn-secondary" style={{ position: 'absolute', top: '20px', right: '20px', padding: '6px 10px', fontSize: '1rem', zIndex: 10 }}>✕</button>
              
              <h3 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent-cyan)', marginBottom: '4px' }}>📊 Usage Statistics</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Water volume consumed ({volUnit}).</p>
              <div style={{ padding: '10px', background: 'rgba(255,200,0,0.1)', borderLeft: '3px solid #fde68a', borderRadius: '4px', fontSize: '0.75rem', color: '#fde68a' }}>
                <strong>Note:</strong> This is only historical data recorded <em>while the app is open and connected</em>. {storeHistoryCloud ? 'It is backed up to the cloud (last ~30 days) and restored on your other devices.' : 'It is stored locally on your device and not synced to the cloud.'} Times shown in {displayTz}.
              </div>
              
              <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '8px' }}>
                 {(['hourly','daily','weekly','monthly'] as const).map(tab => (
                    <button 
                      key={tab}
                      onClick={() => setHistoryTab(tab)}
                      className="btn-secondary"
                      style={{ 
                        flex: 1, 
                        padding: '8px', 
                        fontSize: '0.8rem', 
                        textTransform: 'capitalize',
                        background: historyTab === tab ? 'var(--accent-cyan)' : 'rgba(255,255,255,0.05)',
                        color: historyTab === tab ? '#000' : 'var(--text-primary)',
                        borderColor: historyTab === tab ? 'var(--accent-cyan)' : 'rgba(255,255,255,0.1)'
                      }}
                    >{tab}</button>
                 ))}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px' }}>
                {(() => {
                  const data: Record<string, number> = {};
                  const now = new Date();
                  Object.entries(usageHistory).forEach(([iso, vol]) => {
                    const d = new Date(iso);
                    let key = '';
                    if (historyTab === 'hourly') {
                       if (now.getTime() - d.getTime() > 24 * 3600000) return;
                       key = formatTime(d, {hour: '2-digit'});
                    } else if (historyTab === 'daily') {
                       if (now.getTime() - d.getTime() > 7 * 24 * 3600000) return;
                       key = formatDate(d, {weekday: 'short', month: 'short', day: 'numeric'});
                    } else if (historyTab === 'weekly') {
                       if (now.getTime() - d.getTime() > 30 * 24 * 3600000) return;
                       const diff = d.getDate() - d.getDay();
                       const weekStart = new Date(new Date(d).setDate(diff));
                       key = 'Week of ' + formatDate(weekStart, {month: 'short', day: 'numeric'});
                    } else {
                       if (now.getTime() - d.getTime() > 365 * 24 * 3600000) return;
                       key = formatDate(d, {month: 'short', year: 'numeric'});
                    }
                    data[key] = (data[key] || 0) + vol;
                  });

                  const entries = Object.entries(data);
                  if (entries.length === 0) return <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>No historical data available for this timeframe.</div>;

                  const maxVol = Math.max(...entries.map(e => e[1]));

                  return entries.map(([label, v]) => {
                     const displayV = unitSystem === 'imperial' ? v * 0.264172 : v;
                     const displayMax = unitSystem === 'imperial' ? maxVol * 0.264172 : maxVol;
                     const width = displayMax > 0 ? (displayV / displayMax) * 100 : 0;
                     return (
                       <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                         <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                           <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                           <span style={{ fontWeight: 600 }}>{displayV.toFixed(1)} {volUnit}</span>
                         </div>
                         <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                           <div style={{ width: `${width}%`, height: '100%', background: 'linear-gradient(90deg, #00f2fe, #4facfe)', borderRadius: '4px' }}></div>
                         </div>
                       </div>
                     );
                  });
                })()}
              </div>
           </div>
        </div>
      )}
    </div>
  );
}
