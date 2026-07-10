// LinkTap valve command senders (start / stop), extracted from LinkTapWidget (Task 3 hook-split).
//
// Owns the optimistic command lock (expectedWateringStateRef + commandTimeoutRef +
// lastCommandTimeRef + isCommandLoading), the washdown-resume transition ref, and the
// commandersRef the automations use to issue UNGATED commands (auto-restart, washdown
// resume, flood shutoff). User-initiated commands go through the role-gated wrappers.
//
// Command path (unchanged): signed-in users prefer the worker's role-checked
// /api/control (retires the direct-LinkTap multi-instance race); the LAN gateway is
// the fallback and the local-only path. SAFETY: opens always carry duration/volume
// limits supplied by the caller — never weaken that (AGENTS.md).
import { useState, useRef } from 'react';
import { auth } from '../services/firebase';
import { getActiveVehicleId } from '../utils/VehicleManager';
import { sendLinkTapControl } from '../utils/linktapControl';
import { unifiedFetch } from '../utils/linktapHttp';
import { commandLockMs } from '../utils/valveAutomation';
import type { AlertLog } from './useDeviceHistory';

export interface LinkTapCommandsConfig {
  gatewayIp: string;
  gatewayId: string;
  deviceId: string;
  /** poll interval (secs) — sizes the optimistic-lock window */
  effectiveIntervalSecs: number;
  /** sharing-role gate: monitor-only users can view but not operate */
  canControl: boolean;
  addLog: (type: AlertLog['type'], message: string) => void;
  setErrorMsg: (msg: string | null) => void;
  setTargetDuration: (secs: number) => void;
  setTargetVolume: (liters: number) => void;
  setVolume: (liters: number) => void;
  setVolumeOffset: (liters: number) => void;
  setDurationOffset: (secs: number) => void;
  /** speed up the next poll to detect the state change faster */
  requestRefresh: () => void;
}

export type CommandLoading = boolean | 'start' | 'stop';

export interface LinkTapCommands {
  /** role-gated user start */
  executeStartCommand: (durationMins: number, volumeLimitLiters: number) => void;
  /** role-gated user stop ('manual'); automations pass 'limit' (ungated) */
  executeStopCommand: (reason?: 'manual' | 'limit') => Promise<void>;
  /** ungated start — automations only */
  executeStartCommandRaw: (durationMins: number, volumeLimitLiters: number) => Promise<void>;
  /** live handles for the poll/automation closures */
  commandersRef: React.MutableRefObject<{ start: any; stop: any }>;
  lastCommandTimeRef: React.MutableRefObject<number>;
  expectedWateringStateRef: React.MutableRefObject<boolean | null>;
  commandTimeoutRef: React.MutableRefObject<any>;
  washDownTransitionTimeRef: React.MutableRefObject<number | null>;
  manualStopTriggeredRef: React.MutableRefObject<boolean>;
  isCommandLoading: CommandLoading;
  setIsCommandLoading: React.Dispatch<React.SetStateAction<CommandLoading>>;
  isSoftwareCutoffActive: boolean;
  setIsSoftwareCutoffActive: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useLinkTapCommands(cfg: LinkTapCommandsConfig): LinkTapCommands {
  const [isCommandLoading, setIsCommandLoading] = useState<CommandLoading>(false);
  const [isSoftwareCutoffActive, setIsSoftwareCutoffActive] = useState(false);
  const lastCommandTimeRef = useRef<number>(0);
  const expectedWateringStateRef = useRef<boolean | null>(null);
  const commandTimeoutRef = useRef<any>(null);
  const washDownTransitionTimeRef = useRef<number | null>(null);
  const manualStopTriggeredRef = useRef<boolean>(false);
  const commandersRef = useRef({ start: null as any, stop: null as any });

  const { gatewayIp, gatewayId, deviceId, effectiveIntervalSecs, canControl, addLog, setErrorMsg, requestRefresh } = cfg;

  // cmd 6: Start watering
  const executeStartCommandRaw = async (durationMins: number, volumeLimitLiters: number) => {
    cfg.setTargetDuration(durationMins * 60);
    cfg.setTargetVolume(volumeLimitLiters);
    cfg.setVolume(0);
    cfg.setVolumeOffset(0);
    cfg.setDurationOffset(0);

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

      // 1. Prefer the worker's role-checked /api/control — the app no longer calls LinkTap cloud
      // directly, so a stale signed-in copy can't fight over the valve (retires the multi-instance
      // race). Signed-in only; local-only users skip straight to the LAN gateway below.
      if (auth.currentUser) {
        try {
          const vid = getActiveVehicleId();
          const token = await auth.currentUser.getIdToken();
          if (vid && token) {
            const { DEFAULT_WORKER_URL } = await import('../utils/configSync');
            const base = localStorage.getItem('sh_webhook_url') || DEFAULT_WORKER_URL;
            const r = await sendLinkTapControl(base, token, vid, 'open', durationMins * 60);
            if (r.ok) { success = true; addLog('success', 'Open command relayed via cloud server.'); }
            else addLog('warning', `Cloud control failed: ${r.error}. Falling back to Local API...`);
          }
        } catch (e: any) {
          addLog('warning', `Cloud control error: ${e.message}. Falling back to Local API...`);
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
      const lockDuration = commandLockMs(effectiveIntervalSecs);
      commandTimeoutRef.current = setTimeout(() => {
         if (expectedWateringStateRef.current !== null) {
             expectedWateringStateRef.current = null;
             setIsCommandLoading(false);
         }
      }, lockDuration);

      const refreshDelay = 2500;
      setTimeout(requestRefresh, refreshDelay); // Speed up next poll to detect change faster
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

      // 1. Prefer the worker's role-checked /api/control (retires the direct-LinkTap race).
      // Signed-in only; local-only users skip to the LAN gateway below.
      if (auth.currentUser) {
        try {
          const vid = getActiveVehicleId();
          const token = await auth.currentUser.getIdToken();
          if (vid && token) {
            const { DEFAULT_WORKER_URL } = await import('../utils/configSync');
            const base = localStorage.getItem('sh_webhook_url') || DEFAULT_WORKER_URL;
            const r = await sendLinkTapControl(base, token, vid, 'close');
            if (r.ok) { success = true; addLog('success', 'Stop command relayed via cloud server.'); }
            else addLog('warning', `Cloud control stop failed: ${r.error}. Falling back to Local API...`);
          }
        } catch (e: any) {
          addLog('warning', `Cloud control stop error: ${e.message}. Falling back to Local API...`);
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

      const lockDuration = commandLockMs(effectiveIntervalSecs);
      commandTimeoutRef.current = setTimeout(() => {
         if (expectedWateringStateRef.current !== null) {
             expectedWateringStateRef.current = null;
             setIsCommandLoading(false);
         }
      }, lockDuration);

      const refreshDelay = 2500;
      setTimeout(requestRefresh, refreshDelay); // Speed up next poll to detect change faster
    } catch (err: any) {
      addLog('danger', `API Stop command failed: ${err.message}`);
      setErrorMsg(err.message);
      expectedWateringStateRef.current = null;
      setIsCommandLoading(false);
    }
  };

  commandersRef.current.stop = executeStopCommand;

  return {
    executeStartCommand,
    executeStopCommand,
    executeStartCommandRaw,
    commandersRef,
    lastCommandTimeRef,
    expectedWateringStateRef,
    commandTimeoutRef,
    washDownTransitionTimeRef,
    manualStopTriggeredRef,
    isCommandLoading,
    setIsCommandLoading,
    isSoftwareCutoffActive,
    setIsSoftwareCutoffActive,
  };
}
