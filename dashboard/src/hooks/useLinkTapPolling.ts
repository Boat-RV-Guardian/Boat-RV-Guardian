// LinkTap real-time polling loop, extracted from LinkTapWidget (Task 3 hook-split).
//
// Owns the valve telemetry state (rf-link / alarms / signal / battery / watering /
// speed / remain / connection / flow history) and the poll cycle that feeds it:
//   1. LAN gateway first (cmd 3) for fast local telemetry;
//   2. off-LAN, the SERVER-observed state (worker cache from LinkTap's pushed
//      webhooks) — the app never polls LinkTap cloud directly (multi-instance race);
//   3. the local-data path also drives the SAFETY-CRITICAL software volume cutoff,
//      the external-open max-volume cap, auto-restart, washdown resume, and usage
//      history. Decision rules live in utils/valveAutomation + utils/valveSafety.
// Commands are issued through the commandersRef/refs handed in from
// useLinkTapCommands. Behavior is unchanged from the original inline version.
import { useEffect, useRef, useState } from 'react';
import { auth } from '../services/firebase';
import { unifiedFetch, extractJsonFromMaybeHtml, coerceWateringBool, isTauriEnv } from '../utils/linktapHttp';
import { normalizeCloudStatus, swapBatterySignal, pickTargetVolume, pickTargetDuration } from '../utils/linktapStatus';
import { shouldEnforceVolumeCutoff } from '../utils/valveSafety';
import { normalRunCommand, commandLockMs, autoRestartDecision, washdownTick } from '../utils/valveAutomation';
import { externalOpenCapLiters } from '../utils/quickOpen';
import { type DeviceConfig } from '../utils/VehicleManager';
import { type LinkTapCloudState } from '../utils/linktapCloudState';
import { type FlowData } from '../utils/flowChart';
import type { AlertLog } from './useDeviceHistory';
import type { LinkTapCommands } from './useLinkTapCommands';

/** Widget-owned values the poll closure must read LIVE (via an internal ref). */
export interface LinkTapPollProfile {
  autoRestartNormal: boolean;
  normalRunDaily: boolean;
  normalRunHours: number;
  normalRunMinutes: number;
  normalRunVolume: number;
  unitSystem: 'metric' | 'imperial';
  enableHistory: boolean;
  targetVolume: number;
  targetDuration: number;
}

export interface LinkTapPollingConfig {
  device: DeviceConfig;
  gatewayIp: string;
  gatewayId: string;
  deviceId: string;
  isCloudPollingActive: boolean;
  isLocalPollingActive: boolean;
  refreshInterval: number;
  effectiveIntervalSecs: number;
  pollIntervalSecs: number;
  /** bump to force a fast re-poll (commands set this after 2.5s) */
  manualRefresh: number;
  cloudUsername: string;
  cloudApiKey: string;
  /** server-observed valve state (worker cache) — the off-LAN source */
  serverState: LinkTapCloudState | null;
  /** Auto-Restart (Loop) offered only in local-only mode / Free plan */
  autoRestartAvailable: boolean;
  profile: LinkTapPollProfile;
  /** command lock refs + commanders from useLinkTapCommands */
  commands: Pick<LinkTapCommands,
    'commandersRef' | 'expectedWateringStateRef' | 'commandTimeoutRef' | 'lastCommandTimeRef' |
    'manualStopTriggeredRef' | 'washDownTransitionTimeRef' | 'setIsCommandLoading'>;
  setTargetVolume: (liters: number) => void;
  setTargetDuration: (secs: number) => void;
  setVolume: (liters: number) => void;
  setVolumeOffset: (liters: number) => void;
  setDurationOffset: (secs: number) => void;
  setUsageHistory: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  addLog: (type: AlertLog['type'], message: string) => void;
  setErrorMsg: (msg: string | null) => void;
}

export interface LinkTapTelemetry {
  isRfLinked: boolean;
  isBroken: boolean;
  setIsBroken: React.Dispatch<React.SetStateAction<boolean>>;
  isLeak: boolean;
  setIsLeak: React.Dispatch<React.SetStateAction<boolean>>;
  isClog: boolean;
  setIsClog: React.Dispatch<React.SetStateAction<boolean>>;
  signal: number;
  battery: number;
  setBattery: React.Dispatch<React.SetStateAction<number>>;
  isWatering: boolean;
  speed: number;
  remainDuration: number;
  connectionStatus: 'connected' | 'disconnected' | 'connecting';
  lastUpdated: number | null;
  flowHistory: FlowData[];
}

export function useLinkTapPolling(cfg: LinkTapPollingConfig): LinkTapTelemetry {
  // --- Real-time API States (matched to G2S Gateway Schema) ---
  const [isRfLinked, setIsRfLinked] = useState(true);
  const [isBroken, setIsBroken] = useState(false);
  const [isLeak, setIsLeak] = useState(false);
  const [isClog, setIsClog] = useState(false);
  const [signal, setSignal] = useState(85);
  const [battery, setBattery] = useState(95);
  const [isWatering, setIsWatering] = useState(false);
  const [speed, setSpeed] = useState(0.0);
  const [remainDuration, setRemainDuration] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('disconnected');
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [flowHistory, setFlowHistory] = useState<FlowData[]>([]);

  const previousVolumeRef = useRef<number>(0);
  const lastPollTimeRef = useRef<number>(0);

  // Live handles for the poll closure (it outlives any single render).
  const serverStateRef = useRef(cfg.serverState);
  serverStateRef.current = cfg.serverState;
  const autoRestartAvailableRef = useRef(cfg.autoRestartAvailable);
  autoRestartAvailableRef.current = cfg.autoRestartAvailable;

  // Poll-visible snapshot of widget + telemetry state (same shape/timing as the
  // original widget stateRef: refreshed by effect after each relevant change).
  const p = cfg.profile;
  const stateRef = useRef({ isWatering, remainDuration, speed, ...p });
  useEffect(() => {
    stateRef.current = { isWatering, remainDuration, speed, ...p };
  }, [isWatering, remainDuration, speed, p.autoRestartNormal, p.normalRunDaily, p.normalRunHours, p.normalRunMinutes, p.normalRunVolume, p.unitSystem, p.enableHistory, p.targetVolume, p.targetDuration]);

  const { device, gatewayIp, gatewayId, deviceId, isCloudPollingActive, isLocalPollingActive,
    refreshInterval, effectiveIntervalSecs: effectiveInterval, pollIntervalSecs: pollInterval,
    manualRefresh, cloudUsername, cloudApiKey, addLog, setErrorMsg } = cfg;
  const { commandersRef, expectedWateringStateRef, commandTimeoutRef, lastCommandTimeRef,
    manualStopTriggeredRef, washDownTransitionTimeRef, setIsCommandLoading } = cfg.commands;

  // --- Real-time Polling Logic ---
  useEffect(() => {
    setConnectionStatus('disconnected');

    const poll = async () => {
      // DEMO: no network — mirror the deterministic server-observed valve state (fed by
      // useLinkTapCloudState's generator) into the display, always "connected", never errors.
      if (__DEMO__) {
        const ss = serverStateRef.current;
        if (ss && ss.at > 0) {
          setIsRfLinked(true); setIsBroken(false); setIsLeak(false); setIsClog(false);
          setBattery(ss.battery ?? 0);
          setSignal(ss.signal ?? 0);
          setIsWatering(!!ss.isWatering);
          setSpeed(ss.isWatering && ss.flow != null ? ss.flow : 0);
          setLastUpdated(ss.at);
          setConnectionStatus('connected');
          setErrorMsg(null);
        }
        return;
      }
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

        // 2. Off-LAN: use the SERVER-observed state (worker cache from LinkTap's pushed webhooks)
        //    instead of polling LinkTap's cloud directly. The app no longer reads LinkTap cloud, so a
        //    stale copy can't add polling load / race. Values are already clean (no swap/normalize).
        //    We set the basic display state and return — the local-only logic (volume cutoff / history /
        //    auto-restart) needs continuous LAN data and is skipped off-LAN (it was unreliable via the
        //    old cloud poll too). Signed-in only; local-only users have no server cache.
        if (!data && auth.currentUser) {
           const ss = serverStateRef.current;
           if (ss && ss.at > 0) {
             const wat = !!ss.isWatering;
             setIsRfLinked(true);
             setIsBroken(false); setIsLeak(false); setIsClog(false);
             setBattery(ss.battery ?? 0);
             setSignal(ss.signal ?? 0);
             setIsWatering(wat);
             setSpeed(wat && ss.flow != null ? ss.flow : 0);
             setLastUpdated(ss.at);
             setConnectionStatus('connected');
             // Clear the optimistic command lock once the server reflects the commanded state.
             if (expectedWateringStateRef.current !== null && wat === expectedWateringStateRef.current) {
               expectedWateringStateRef.current = null;
               setIsCommandLoading(false);
               if (commandTimeoutRef.current) clearTimeout(commandTimeoutRef.current);
             }
           }
           return; // no LAN data + no direct-cloud read — done for this tick
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
            const lockDuration = commandLockMs(effectiveInterval);
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
        const restart = autoRestartDecision({
          wasWatering: stateRef.current.isWatering,
          isWatering: newIsWatering,
          autoRestartEnabled: stateRef.current.autoRestartNormal,
          autoRestartAvailable: autoRestartAvailableRef.current,
          lastRemainDuration: stateRef.current.remainDuration,
          effectiveIntervalSecs: effectiveInterval,
          manualStopTriggered: manualStopTriggeredRef.current,
        });
        if (restart === 'skip-manual-stop') {
          addLog('info', 'Valve closed manually before timer expired. Auto-restart skipped.');
          manualStopTriggeredRef.current = false;
        } else if (restart === 'restart') {
          addLog('info', 'Timer expired. Auto-restart is ON. Restarting Normal Run profile in 5 seconds...');
          setTimeout(() => {
             const cmd = normalRunCommand(stateRef.current);
             if (commandersRef.current.start) commandersRef.current.start(cmd.durationMins, cmd.volumeLiters);
          }, 5000);
        }

        if (stateRef.current.isWatering && !newIsWatering) {
            cfg.setVolumeOffset(0);
            cfg.setDurationOffset(0);
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
        if (apiTargetVol > 0 && stateRef.current.targetVolume === 0) cfg.setTargetVolume(apiTargetVol);

        const apiTargetDur = pickTargetDuration(data);
        if (apiTargetDur > 0 && stateRef.current.targetDuration === 0) cfg.setTargetDuration(apiTargetDur * 60); // assume minutes from API

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
                        if (cVol > 0 && stateRef.current.targetVolume === 0) cfg.setTargetVolume(cVol);
                        if (cDur > 0 && stateRef.current.targetDuration === 0) cfg.setTargetDuration(cDur * 60);
                    }
                }).catch(e => {
                    (window as any).fetchingLimits = false;
                    console.warn('Background cloud fetch for limits failed', e);
                });
            }
        }

        // Externally-started open (physical button on the valve, or the LinkTap app): if it's watering
        // with no volume limit we know of and WE didn't start this cycle, apply the per-valve max-volume
        // safety cap so a manual open can't run unbounded. The software cutoff below then enforces it.
        // (A cloud-discovered limit above would already have set targetVolume, making this a no-op.)
        if (newIsWatering && stateRef.current.targetVolume === 0 && expectedWateringStateRef.current !== true) {
           const capL = externalOpenCapLiters(device);
           cfg.setTargetVolume(capL);
           addLog('warning', `Externally-started run detected — applying a ${capL} L max-volume safety cap.`);
        }

        const currentVolume = Number(data.volume ?? data.vol ?? 0);

        // Software-enforced volume cutoff
        // LinkTap hardware often ignores volume limits passed to cmd: 6, so we must enforce it here!
        // Read targetVolume from the ref (not the render closure) so a limit discovered mid-cycle
        // via setTargetVolume above is honored on the same poll.
        if (shouldEnforceVolumeCutoff(newIsWatering, stateRef.current.targetVolume, currentVolume)) {
           if (commandersRef.current.stop && expectedWateringStateRef.current !== false) {
              addLog('success', `Target volume limit reached. Sending software-enforced stop command.`);
              commandersRef.current.stop('limit');
              expectedWateringStateRef.current = false;
              setIsCommandLoading('stop');
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
            cfg.setUsageHistory(prev => ({ ...prev, [bucket]: (prev[bucket] || 0) + delta }));
          }
        }
        previousVolumeRef.current = currentVolume;
        cfg.setVolume(currentVolume);

        const wd = washdownTick(washDownTransitionTimeRef.current, Date.now());
        if (wd.phase === 'expired') {
          // Washdown timer expired! Reprogram to Normal Cycle!
          addLog('info', 'Washdown complete! Resuming Normal Run profile without shutting off valve...');
          washDownTransitionTimeRef.current = null;
          const cmd = normalRunCommand(stateRef.current);
          if (commandersRef.current.start) commandersRef.current.start(cmd.durationMins, cmd.volumeLiters);
        } else if (wd.phase === 'running') {
          // Override UI remain duration so it shows the exact Washdown time instead of Washdown + Buffer
          data.remain_duration = wd.remainSecs;
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

  return {
    isRfLinked,
    isBroken, setIsBroken,
    isLeak, setIsLeak,
    isClog, setIsClog,
    signal,
    battery, setBattery,
    isWatering,
    speed,
    remainDuration,
    connectionStatus,
    lastUpdated,
    flowHistory,
  };
}
