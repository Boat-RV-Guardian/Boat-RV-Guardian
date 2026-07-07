// LinkTap valve command senders (open / close), extracted from LinkTapWidget.
//
// Both senders prefer the worker's role-checked /api/control relay — the app no longer calls
// LinkTap cloud directly, so a stale signed-in copy can't fight over the valve (retires the
// multi-instance race; see the LinkTap event-driven redesign) — and fall back to the LAN gateway
// (cmd 6 / cmd 7) for local-only users or when the relay fails.
//
// The open command is the SAFETY NET: every open carries a duration and volume limit, and the
// optimistic command lock (lastCommandTimeRef / expectedWateringStateRef / commandTimeoutRef) is
// shared with the poll loop so the UI doesn't flicker while the physical valve moves. Those refs
// are owned by LinkTapWidget and passed in here — there must only ever be ONE instance of each.
// Behavior is unchanged from the original inline version.
import type React from 'react';
import { auth } from '../services/firebase';
import { getActiveVehicleId } from '../utils/VehicleManager';
import { sendLinkTapControl } from '../utils/linktapControl';
import { unifiedFetch } from '../utils/linktapHttp';
import type { AlertLog } from './useDeviceHistory';

export interface LinkTapCommandDeps {
  // --- Config (current render values; the widget re-calls the hook every render) ---
  gatewayIp: string;
  gatewayId: string;
  deviceId: string;
  effectiveInterval: number;
  canControl: boolean;
  // --- Shared command/state-machine refs (single instances owned by LinkTapWidget) ---
  lastCommandTimeRef: React.MutableRefObject<number>;
  expectedWateringStateRef: React.MutableRefObject<boolean | null>;
  commandTimeoutRef: React.MutableRefObject<any>;
  washDownTransitionTimeRef: React.MutableRefObject<number | null>;
  // --- Widget state setters ---
  setTargetDuration: React.Dispatch<React.SetStateAction<number>>;
  setTargetVolume: React.Dispatch<React.SetStateAction<number>>;
  setVolume: React.Dispatch<React.SetStateAction<number>>;
  setVolumeOffset: React.Dispatch<React.SetStateAction<number>>;
  setDurationOffset: React.Dispatch<React.SetStateAction<number>>;
  setIsCommandLoading: React.Dispatch<React.SetStateAction<boolean | 'start' | 'stop'>>;
  setErrorMsg: React.Dispatch<React.SetStateAction<string | null>>;
  setIsSoftwareCutoffActive: React.Dispatch<React.SetStateAction<boolean>>;
  setManualRefresh: React.Dispatch<React.SetStateAction<number>>;
  addLog: (type: AlertLog['type'], message: string) => void;
}

export interface LinkTapCommands {
  executeStartCommandRaw: (durationMins: number, volumeLimitLiters: number) => Promise<void>;
  executeStartCommand: (durationMins: number, volumeLimitLiters: number) => void;
  executeStopCommand: (reason?: 'manual' | 'limit') => Promise<void>;
}

export function useLinkTapCommands(deps: LinkTapCommandDeps): LinkTapCommands {
  const {
    gatewayIp, gatewayId, deviceId, effectiveInterval, canControl,
    lastCommandTimeRef, expectedWateringStateRef, commandTimeoutRef, washDownTransitionTimeRef,
    setTargetDuration, setTargetVolume, setVolume, setVolumeOffset, setDurationOffset,
    setIsCommandLoading, setErrorMsg, setIsSoftwareCutoffActive, setManualRefresh, addLog,
  } = deps;

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

  return { executeStartCommandRaw, executeStartCommand, executeStopCommand };
}
