// LinkTap real-time poll loop, extracted from LinkTapWidget.
//
// Poll priority per tick (unchanged from the original inline version):
//   DEMO: mirror the deterministic server-observed state from useLinkTapCloudState — no network.
//   1. Local LAN gateway (cmd 3) for fast telemetry when local polling is on.
//   2. Off-LAN (signed in): the SERVER-observed state (worker cache fed by LinkTap's pushed
//      webhooks) — the read half of retiring the app's direct LinkTap-cloud polling and the
//      multi-instance race. Local-only automation (volume cutoff / history / auto-restart /
//      washdown) is skipped in this branch because it needs continuous LAN data.
//
// This loop is one half of the valve's SAFETY logic: it clears the optimistic command lock,
// enforces the software volume cutoff (LinkTap hardware often ignores cmd 6 volume limits),
// drives auto-restart and the washdown→normal transition via commandersRef, and records usage
// history. The refs it consumes (stateRef, commandersRef, expectedWateringStateRef,
// lastPollTimeRef, ...) are owned by LinkTapWidget and shared with useLinkTapCommands — there
// must only ever be ONE instance of each.
import { useEffect } from 'react';
import type React from 'react';
import { auth } from '../services/firebase';
import { isTauriEnv, unifiedFetch, extractJsonFromMaybeHtml, coerceWateringBool } from '../utils/linktapHttp';
import { normalizeCloudStatus, swapBatterySignal, pickTargetVolume, pickTargetDuration } from '../utils/linktapStatus';
import { shouldEnforceVolumeCutoff } from '../utils/valveSafety';
import type { LinkTapCloudState } from '../utils/linktapCloudState';
import type { FlowData } from '../utils/flowChart';
import type { AlertLog } from './useDeviceHistory';

// Snapshot of the widget state the poll closure reads via ref (so the interval sees live values
// without re-arming on every state change).
export interface LinkTapLiveState {
  isWatering: boolean;
  remainDuration: number;
  speed: number;
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

export interface LinkTapPollDeps {
  // --- Config (current render values) ---
  deviceEnabled: boolean | undefined;
  gatewayIp: string;
  gatewayId: string;
  deviceId: string;
  cloudUsername: string;
  cloudApiKey: string;
  isLocalPollingActive: boolean;
  isCloudPollingActive: boolean;
  refreshInterval: number;
  effectiveInterval: number;
  manualRefresh: number;
  // --- Shared refs (single instances owned by LinkTapWidget) ---
  serverStateRef: React.MutableRefObject<LinkTapCloudState | null>;
  expectedWateringStateRef: React.MutableRefObject<boolean | null>;
  commandTimeoutRef: React.MutableRefObject<any>;
  lastCommandTimeRef: React.MutableRefObject<number>;
  stateRef: React.MutableRefObject<LinkTapLiveState>;
  commandersRef: React.MutableRefObject<{ start: any; stop: any }>;
  previousVolumeRef: React.MutableRefObject<number>;
  lastPollTimeRef: React.MutableRefObject<number>;
  // --- Widget state setters ---
  setIsRfLinked: React.Dispatch<React.SetStateAction<boolean>>;
  setIsBroken: React.Dispatch<React.SetStateAction<boolean>>;
  setIsLeak: React.Dispatch<React.SetStateAction<boolean>>;
  setIsClog: React.Dispatch<React.SetStateAction<boolean>>;
  setSignal: React.Dispatch<React.SetStateAction<number>>;
  setBattery: React.Dispatch<React.SetStateAction<number>>;
  setIsWatering: React.Dispatch<React.SetStateAction<boolean>>;
  setSpeed: React.Dispatch<React.SetStateAction<number>>;
  setVolume: React.Dispatch<React.SetStateAction<number>>;
  setRemainDuration: React.Dispatch<React.SetStateAction<number>>;
  setLastUpdated: React.Dispatch<React.SetStateAction<number | null>>;
  setConnectionStatus: React.Dispatch<React.SetStateAction<'connected' | 'disconnected' | 'connecting'>>;
  setErrorMsg: React.Dispatch<React.SetStateAction<string | null>>;
  setIsCommandLoading: React.Dispatch<React.SetStateAction<boolean | 'start' | 'stop'>>;
  setVolumeOffset: React.Dispatch<React.SetStateAction<number>>;
  setDurationOffset: React.Dispatch<React.SetStateAction<number>>;
  setTargetVolume: React.Dispatch<React.SetStateAction<number>>;
  setTargetDuration: React.Dispatch<React.SetStateAction<number>>;
  setFlowHistory: React.Dispatch<React.SetStateAction<FlowData[]>>;
  setUsageHistory: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  addLog: (type: AlertLog['type'], message: string) => void;
  // --- Automation hook points (from useLinkTapAutomation), called at the exact spots the
  //     inline auto-restart / washdown-resume code used to run within a poll tick ---
  maybeScheduleAutoRestart: (newIsWatering: boolean) => void;
  applyWashdownTransition: (data: any) => void;
}

export function useLinkTapPoll(deps: LinkTapPollDeps): void {
  const {
    deviceEnabled, gatewayIp, gatewayId, deviceId, cloudUsername, cloudApiKey,
    isLocalPollingActive, isCloudPollingActive, refreshInterval, effectiveInterval, manualRefresh,
    serverStateRef, expectedWateringStateRef, commandTimeoutRef, lastCommandTimeRef,
    stateRef, commandersRef, previousVolumeRef, lastPollTimeRef,
    setIsRfLinked, setIsBroken, setIsLeak, setIsClog, setSignal, setBattery,
    setIsWatering, setSpeed, setVolume, setRemainDuration, setLastUpdated,
    setConnectionStatus, setErrorMsg, setIsCommandLoading,
    setVolumeOffset, setDurationOffset, setTargetVolume, setTargetDuration,
    setFlowHistory, setUsageHistory, addLog,
    maybeScheduleAutoRestart, applyWashdownTransition,
  } = deps;

  // Pin to 31s when cloud-only (local disconnected) to respect the API rate limit.
  // Use the slider value when local is active for fast real-time telemetry.
  // DEMO: tick fast off the in-memory generator (no rate limit — nothing hits the network).
  const pollInterval = __DEMO__ ? 2 : ((isLocalPollingActive && gatewayIp) ? effectiveInterval : 31);

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
      if (deviceEnabled === false || (!isLocalPollingActive && !isCloudPollingActive)) {
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

        // Auto-restart (Normal Run loop) — logic lives in useLinkTapAutomation.
        maybeScheduleAutoRestart(newIsWatering);

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
            setUsageHistory(prev => ({ ...prev, [bucket]: (prev[bucket] || 0) + delta }));
          }
        }
        previousVolumeRef.current = currentVolume;
        setVolume(currentVolume);

        // Washdown → Normal Run transition — logic lives in useLinkTapAutomation.
        // (May override data.remain_duration for display while the washdown window is active.)
        applyWashdownTransition(data);

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
  // Dep list preserved verbatim from the widget (plus device.enabled → deviceEnabled).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatewayIp, gatewayId, deviceId, isCloudPollingActive, isLocalPollingActive, refreshInterval, effectiveInterval, pollInterval, manualRefresh, cloudUsername, cloudApiKey, deviceEnabled]);
}
