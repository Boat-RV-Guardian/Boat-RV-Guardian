// LinkTap automation logic, extracted from LinkTapWidget:
//   - Flooding Sentry: the Tauri 'flood-alarm' listener that instantly closes the valve.
//   - Auto-restart: relaunch the Normal Run profile when its timer expires naturally.
//   - Washdown resume: reprogram to the Normal Run profile when the washdown window ends,
//     without ever closing the valve (the hardware run was sent with a +5 min buffer).
//
// Auto-restart and washdown-resume are still DRIVEN BY THE POLL LOOP — useLinkTapPoll calls the
// two helpers returned here at the exact points the inline code used to run, so ordering within a
// poll tick is unchanged. Everything reads live values through the widget-owned refs
// (stateRef / commandersRef / washDownTransitionTimeRef / manualStopTriggeredRef) shared with
// useLinkTapCommands and useLinkTapPoll — there must only ever be ONE instance of each.
// Behavior is unchanged from the original inline version.
import { useEffect } from 'react';
import type React from 'react';
import { listenTauri } from '../utils/linktapHttp';
import type { AlertLog } from './useDeviceHistory';
import type { LinkTapLiveState } from './useLinkTapPoll';

export interface LinkTapAutomationDeps {
  effectiveInterval: number;
  // --- Shared refs (single instances owned by LinkTapWidget) ---
  commandersRef: React.MutableRefObject<{ start: any; stop: any }>;
  stateRef: React.MutableRefObject<LinkTapLiveState>;
  washDownTransitionTimeRef: React.MutableRefObject<number | null>;
  manualStopTriggeredRef: React.MutableRefObject<boolean>;
  // --- Widget callbacks ---
  setIsFloodAlarmActive: React.Dispatch<React.SetStateAction<boolean>>;
  playSynthesizedAlarm: (soundOverride?: string) => void;
  triggerAlert: (title: string, message: string, silent?: boolean) => Promise<void>;
  addLog: (type: AlertLog['type'], message: string) => void;
}

export interface LinkTapAutomation {
  /** Poll-tick hook point: schedule the Normal Run restart if the run just expired naturally. */
  maybeScheduleAutoRestart: (newIsWatering: boolean) => void;
  /** Poll-tick hook point: handle the washdown→Normal Run transition (mutates data.remain_duration). */
  applyWashdownTransition: (data: any) => void;
}

export function useLinkTapAutomation(deps: LinkTapAutomationDeps): LinkTapAutomation {
  const {
    effectiveInterval, commandersRef, stateRef, washDownTransitionTimeRef, manualStopTriggeredRef,
    setIsFloodAlarmActive, playSynthesizedAlarm, triggerAlert, addLog,
  } = deps;

  // Flooding Sentry: mount-once listener (matching the original []-dep effect, which also closed
  // over the first render's alert callbacks). The stop command goes through commandersRef so it
  // always uses the CURRENT sender.
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NOTE: Auto-restart is driven entirely by the app — it only loops while the app is open
  // and polling. TODO(future): move this to a cloud worker so it can watch the device and
  // restart the Normal Run timer even when the app is closed.
  const maybeScheduleAutoRestart = (newIsWatering: boolean) => {
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
  };

  const applyWashdownTransition = (data: any) => {
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
  };

  return { maybeScheduleAutoRestart, applyWashdownTransition };
}
