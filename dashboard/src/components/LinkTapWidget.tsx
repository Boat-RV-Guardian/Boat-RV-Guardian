import { useState, useEffect, useRef } from 'react';
import { type DeviceConfig } from '../utils/VehicleManager';
import { formatTime, formatDate, getDisplayTimeZone } from '../utils/time';
import { useDeviceHistory } from '../hooks/useDeviceHistory';
import { useEntitlements } from '../hooks/useEntitlements';
import { useAlarmNotifications } from '../hooks/useAlarmNotifications';
import { useLinkTapCommands } from '../hooks/useLinkTapCommands';
import { useLinkTapPolling } from '../hooks/useLinkTapPolling';
import { useValveSentries } from '../hooks/useValveSentries';
import { drawFlowChart } from '../utils/flowChart';
import { normalRunCommand } from '../utils/valveAutomation';
import { useLinkTapCloudState } from '../hooks/useLinkTapCloudState';
import { isLocalMode } from '../utils/userScope';

const APP_VERSION = '1.0.66';

export default function LinkTapWidget({ device }: { device: DeviceConfig }) {
  // --- Persistent Gateway & Device Configuration ---
  const [cloudUsername, setCloudUsername] = useState(() => localStorage.getItem('lt_cloud_user') || '');
  const [cloudApiKey, setCloudApiKey] = useState(() => localStorage.getItem('lt_cloud_key') || '');
  const [alertOffline, setAlertOffline] = useState(() => localStorage.getItem('lt_alert_offline') !== 'false');
  const [gatewayIp, setGatewayIp] = useState(() => localStorage.getItem('lt_gateway_ip') || '');
  const [gatewayId, setGatewayId] = useState(() => localStorage.getItem('lt_gateway_id') || '');
  const deviceId = device.linktapDeviceId || device.id;
  // Server-observed valve state (worker-cached from LinkTap's pushed webhook events). Displayed AND
  // used as the OFF-LAN source (replacing the app's direct LinkTap-cloud getWateringStatus poll) — the
  // read half of retiring the multi-instance race. serverStateRef gives the poll closure a live handle.
  const serverState = useLinkTapCloudState(deviceId);
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
  // DEMO: tick fast off the in-memory generator (no rate limit — nothing hits the network).
  const pollInterval = __DEMO__ ? 2 : ((isLocalPollingActive && gatewayIp) ? effectiveInterval : 31);

  // --- Local Safety  // Auto-Guard settings
  const autoGuardEnabled = device.autoGuardEnabled !== false;

  // --- User Preferences ---
  const [unitSystem, setUnitSystem] = useState<'metric' | 'imperial'>(() => localStorage.getItem('lt_unit') as 'metric' | 'imperial' || 'imperial');

  const [notifyAutoGuard, setNotifyAutoGuard] = useState(() => localStorage.getItem('lt_notif_autoguard') !== 'false');

  const [notifyLowBattery, setNotifyLowBattery] = useState(() => localStorage.getItem('lt_notif_battery') === 'true');
  const [notifyWatering, setNotifyWatering] = useState(() => localStorage.getItem('lt_notif_watering') === 'true');

  // Session volume (set by both the poll and the command senders; telemetry lives in useLinkTapPolling)
  const [volume, setVolume] = useState(0.0);

  // --- Historical Data Tracking ---
  const [enableHistory, setEnableHistory] = useState(() => localStorage.getItem('lt_enable_history') !== 'false');
  const [storeHistoryCloud, setStoreHistoryCloud] = useState(() => localStorage.getItem('lt_store_history_cloud') === 'true');
  // Usage history + Event Sentry Log state, persistence, and cloud mirroring live in this hook.
  const { usageHistory, setUsageHistory, logs, addLog } = useDeviceHistory(deviceId, storeHistoryCloud);
  // Alarm sound + alert notifications (prefs, repeat loop, WebAudio alarm, web/Tauri/Capacitor notify).
  const { triggerAlert, playSynthesizedAlarm, activeAlarmSound, setActiveAlarmSound, alarmRepeatInterval } = useAlarmNotifications(addLog);
  // Sharing role for the active vehicle ('admin' | 'control' | 'monitor'); monitor = view only.
  const [myRole, setMyRole] = useState(() => localStorage.getItem('lt_my_role') || 'admin');
  const canControl = myRole !== 'monitor';
  useEffect(() => {
    const sync = () => setMyRole(localStorage.getItem('lt_my_role') || 'admin');
    window.addEventListener('role_updated', sync);
    window.addEventListener('settings_updated', sync);
    return () => { window.removeEventListener('role_updated', sync); window.removeEventListener('settings_updated', sync); };
  }, []);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Re-render trigger so already-rendered timestamps reformat when the user changes lt_tz.
  const [displayTz, setDisplayTz] = useState(getDisplayTimeZone());
  // Modal UI state is handled elsewhere now
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

  // Auto-Restart (Loop) is an APP-DRIVEN loop — the app must stay open to re-issue the run when a cycle
  // ends. That only makes sense where there's no server-side scheduling: local-only mode and the Free
  // plan. On paid plans it's hidden (and the loop logic is gated off) so users don't rely on a fragile
  // app-open loop. A ref so the poll closure reads the current value.
  const autoRestartAvailable = isLocalMode(localStorage) || (localStorage.getItem('tier') || '') === 'free';

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
  const [volumeOffset, setVolumeOffset] = useState(0);
  const [durationOffset, setDurationOffset] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // --- PWA Installation Support ---
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(0);

  // Per-vehicle plan entitlements — remote (off-LAN) control is a paid feature (Task 6).
  const entitlements = useEntitlements();

  // Valve command senders + optimistic command lock + washdown transition ref.
  const {
    executeStartCommand, executeStopCommand,
    commandersRef, lastCommandTimeRef, expectedWateringStateRef, commandTimeoutRef,
    washDownTransitionTimeRef, manualStopTriggeredRef,
    isCommandLoading, setIsCommandLoading,
    isSoftwareCutoffActive,
  } = useLinkTapCommands({
    gatewayIp, gatewayId, deviceId,
    effectiveIntervalSecs: effectiveInterval,
    canControl,
    canRemoteControl: entitlements.canRemoteControl,
    addLog,
    setErrorMsg,
    setTargetDuration, setTargetVolume, setVolume, setVolumeOffset, setDurationOffset,
    requestRefresh: () => setManualRefresh(Date.now()),
  });

  // Real-time polling loop: owns the valve telemetry (LAN-first, server-observed off-LAN)
  // and drives the software volume cutoff / external-open cap / auto-restart / washdown resume.
  const {
    isRfLinked, isBroken, setIsBroken, isLeak, setIsLeak, isClog, setIsClog,
    signal, battery, setBattery, isWatering, speed, remainDuration,
    connectionStatus, lastUpdated, flowHistory,
  } = useLinkTapPolling({
    device, gatewayIp, gatewayId, deviceId,
    isCloudPollingActive, isLocalPollingActive,
    refreshInterval, effectiveIntervalSecs: effectiveInterval, pollIntervalSecs: pollInterval,
    manualRefresh, cloudUsername, cloudApiKey,
    serverState,
    autoRestartAvailable,
    profile: { autoRestartNormal, normalRunDaily, normalRunHours, normalRunMinutes, normalRunVolume, unitSystem, enableHistory, targetVolume, targetDuration },
    commands: { commandersRef, expectedWateringStateRef, commandTimeoutRef, lastCommandTimeRef, manualStopTriggeredRef, washDownTransitionTimeRef, setIsCommandLoading },
    setTargetVolume, setTargetDuration, setVolume, setVolumeOffset, setDurationOffset,
    setUsageHistory, addLog, setErrorMsg,
  });

  // --- Display Computed Values ---
  const displaySpeed = unitSystem === 'imperial' ? speed * 0.264172 : speed;
  // "Volume Consumed" is the CURRENT session's usage, so show 0 when the valve is idle — mirroring how
  // speed is 0 when not watering. The device's `vol` field returns a large/garbage value
  // when closed, which previously rendered as the raw total (e.g. ~95M gallons on a closed valve).
  // (volumeOffset is retained for the existing tare hook but is currently always 0.)
  const sessionVolume = isWatering ? Math.max(0, volume - volumeOffset) : 0;
  const displayVolume = unitSystem === 'imperial' ? sessionVolume * 0.264172 : sessionVolume;
  const displayRemain = Math.max(0, remainDuration + durationOffset);
  const speedUnit = unitSystem === 'imperial' ? 'Gal/min' : 'L/min';
  const volUnit = unitSystem === 'imperial' ? 'Gallons' : 'Liters';

  // Dispatch connection state to external listeners (Settings.tsx)
  useEffect(() => {
    const event = new CustomEvent('connection_state_change', {
      detail: { status: connectionStatus, error: errorMsg }
    });
    window.dispatchEvent(event);
  }, [connectionStatus, errorMsg]);

  // Flooding Sentry + safety guard + offline / low-battery / watering-transition alerts.
  const { isFloodAlarmActive, setIsFloodAlarmActive } = useValveSentries({
    autoGuardEnabled, isBroken, isLeak, isWatering, isRfLinked, battery,
    alertOffline, notifyAutoGuard, notifyLowBattery, notifyWatering,
    triggerAlert, playSynthesizedAlarm, executeStopCommand, commandersRef,
  });

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
              <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: battery < 15 ? 'var(--accent-red)' : '#fff' }}>{battery > 0 ? `${battery}%` : '—'}</span>
            </div>

            {/* Signal Strength */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.03)', padding: '6px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
                <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
                <path d="M8.58 16.14a7 7 0 0 1 6.83 0"></path>
                <line x1="12" y1="20" x2="12.01" y2="20"></line>
              </svg>
              <span style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>{isRfLinked ? (signal > 0 ? `LINK OK (${signal}%)` : 'LINK OK') : 'LINK STUCK'}</span>
            </div>

            {/* Connection badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.03)', padding: '6px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <span className={`status-dot ${connectionStatus === 'connected' ? 'online' : connectionStatus}`}></span>
              <span style={{ fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>
                {connectionStatus === 'connected' ? (() => {
                   // "Local" only counts when a gateway IP is actually set (polling flag alone isn't a
                   // connection); "cloud" only when we have an API key. Fixes the false
                   // "CLOUD & LOCAL CONNECTED" when no local IP has been entered yet.
                   const localOn = isLocalPollingActive && !!gatewayIp;
                   const cloudOn = isCloudPollingActive && !!cloudApiKey;
                   return cloudOn && localOn ? 'CLOUD & LOCAL CONNECTED' : cloudOn ? 'CLOUD CONNECTED' : localOn ? 'LOCAL CONNECTED' : 'CONNECTED';
                 })() :
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
          {(isBroken || isLeak) && (
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
                {serverState && serverState.at > 0 && (
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    ☁️ Server-observed: {serverState.isWatering ? 'OPEN' : 'CLOSED'}
                    {serverState.flow != null && serverState.isWatering ? ` · ${serverState.flow.toFixed(1)} L/min` : ''}
                    {serverState.battery != null ? ` · 🔋 ${serverState.battery}%` : ''}
                    {' · '}{formatTime(serverState.at)}
                  </p>
                )}
                {!canControl && (
                  <p style={{ fontSize: '0.78rem', color: '#fde68a', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: '6px', padding: '6px 10px', marginTop: '6px', display: 'inline-block' }}>
                    🔒 Monitor-only access — you can view status but not operate this device.
                  </p>
                )}
                {canControl && !entitlements.canRemoteControl && !isLocalMode(localStorage) && !(isLocalPollingActive && gatewayIp) && (
                  <p style={{ fontSize: '0.78rem', color: '#fde68a', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: '6px', padding: '6px 10px', marginTop: '6px', display: 'inline-block' }}>
                    🔒 Remote control isn't included in your plan — controls work when this device is on
                    the gateway's network. Upgrade to Basic for away control.
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
                    <div style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--accent-cyan)', margin: '4px 0', textShadow: '0 0 15px rgba(0,242,254,0.3)' }}>
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
                  <span style={{ fontWeight: 'bold' }}>{normalRunDaily ? 'Daily' : `${normalRunHours} hr ${normalRunMinutes} min`}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Configured Volume Limit:</span>
                  <span style={{ fontWeight: 'bold' }}>{normalRunVolume} {volUnit}</span>
                </div>
                {autoRestartAvailable ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Auto Restart (Loop):</span>
                    <button
                      onClick={() => setShowAutoRestartModal(true)}
                      title="Tap to change"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', padding: '3px 10px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', color: autoRestartNormal ? 'var(--accent-cyan)' : 'var(--text-muted)' }}
                    >{autoRestartNormal ? 'ENABLED' : 'DISABLED'} ▾</button>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                    🔁 Auto-Restart (Loop) isn't shown on your plan — it's an app-driven loop that only runs
                    while this app stays open, so it's offered only in local-only mode and on the Free plan.
                    To repeat a run hands-free, set a recurring schedule on the gateway in the LinkTap app.
                  </div>
                )}
              </div>
              <button
                disabled={isWatering || !!isCommandLoading}
                onClick={() => {
                   const cmd = normalRunCommand({ normalRunDaily, normalRunHours, normalRunMinutes, normalRunVolume, unitSystem });
                   executeStartCommand(cmd.durationMins, cmd.volumeLiters);
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
