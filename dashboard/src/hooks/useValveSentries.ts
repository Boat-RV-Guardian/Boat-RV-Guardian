// Valve sentry / alerting effects, extracted from LinkTapWidget (Task 3 hook-split).
//
// Watches the telemetry from useLinkTapPolling and reacts:
//   - Flooding Sentry: the Tauri 'flood-alarm' event (desktop local listener) sirens,
//     alerts, and issues an UNGATED 'limit' stop via commandersRef;
//   - Safety Guard: broken-pipe / leak while watering → alert + 'limit' stop
//     (decision logic in utils/valveSafety, already unit-tested);
//   - offline / low-battery / watering-transition notifications.
// Behavior is unchanged from the original inline version.
import { useEffect, useRef, useState } from 'react';
import { listenTauri } from '../utils/linktapHttp';
import { evaluateSafetyGuard } from '../utils/valveSafety';
import type { LinkTapCommands } from './useLinkTapCommands';

export interface ValveSentriesConfig {
  autoGuardEnabled: boolean;
  isBroken: boolean;
  isLeak: boolean;
  isWatering: boolean;
  isRfLinked: boolean;
  battery: number;
  alertOffline: boolean;
  notifyAutoGuard: boolean;
  notifyLowBattery: boolean;
  notifyWatering: boolean;
  triggerAlert: (title: string, message: string, silent?: boolean) => Promise<void>;
  playSynthesizedAlarm: (soundOverride?: string) => void;
  executeStopCommand: LinkTapCommands['executeStopCommand'];
  commandersRef: LinkTapCommands['commandersRef'];
}

export interface ValveSentries {
  isFloodAlarmActive: boolean;
  setIsFloodAlarmActive: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useValveSentries(cfg: ValveSentriesConfig): ValveSentries {
  const [isFloodAlarmActive, setIsFloodAlarmActive] = useState<boolean>(false);
  const hasNotifiedBattery = useRef(false);
  const { autoGuardEnabled, isBroken, isLeak, isWatering, isRfLinked, battery,
    alertOffline, notifyAutoGuard, notifyLowBattery, notifyWatering,
    triggerAlert, playSynthesizedAlarm, executeStopCommand, commandersRef } = cfg;

  // Flooding Sentry: desktop-local flood webhook (Tauri port-3030 listener) → instant shutoff.
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

  // --- Local Safety Guard Auto-Monitoring ---
  useEffect(() => {
    const { shutOff, cause } = evaluateSafetyGuard({
      autoGuardEnabled,
      isBroken,
      isLeak,
      isWatering,
    });

    if (shutOff) {
      if (notifyAutoGuard) triggerAlert('Safety Sentry Triggered', `${cause} Shutting down valve...`);
      executeStopCommand('limit');
    }
  }, [isBroken, isLeak, isWatering, autoGuardEnabled]);

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

  return { isFloodAlarmActive, setIsFloodAlarmActive };
}
