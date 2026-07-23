// Subscribe to the worker-cached LinkTap valve state (vehicles/{vid}/sensorState/linktap_<taplinkerId>)
// written by brvg-cloud-server's /api/linktap from LinkTap's pushed webhook events. Mirrors how
// ShellyWidget reads its device's sensorState, and merges partial LinkTap events via
// mergeLinkTapSensorDoc so the returned state stays coherent (see linktapCloudState.ts).
//
// This is the read half of retiring the app's direct LinkTap-cloud polling: the app displays what the
// server observed, instead of every app instance polling LinkTap itself (the multi-instance race).
// Additive today — consuming it in LinkTapWidget (as the off-LAN/primary source) is the next increment.

import { useEffect, useState } from 'react';
import { db, doc, onSnapshot } from '../services/firebase';
import { getActiveVehicleId } from '../utils/VehicleManager';
import { mergeLinkTapSensorDoc, linkTapSensorStateKey, type LinkTapCloudState } from '../utils/linktapCloudState';
import { demoLinkTapDoc } from '../utils/demoTelemetry';
import { getDemoOverride, mergeDemoDoc, DEMO_SIM_EVENT } from '../utils/demoOverrides';

export function useLinkTapCloudState(taplinkerId: string | undefined | null): LinkTapCloudState | null {
  const [state, setState] = useState<LinkTapCloudState | null>(null);

  useEffect(() => {
    if (!taplinkerId) return;
    // DEMO: no Firestore — tick the deterministic valve generator in place of onSnapshot.
    if (__DEMO__) {
      const tick = () => setState((prev) => {
        const now = Date.now();
        let doc = demoLinkTapDoc(now);
        // A simulated flood forces the valve closed (the safety-shutoff story), same as the scripted one.
        const floodOv = getDemoOverride('demo-flood', now);
        const floodActive = !!floodOv && /alarm on|flood/i.test(floodOv.event || '') && !/off|clear|inactive|dry/i.test(floodOv.event || '');
        if (floodActive) {
          doc = { ...doc, watering: '0', flow: '0', event: 'water cut-off alert', alarm: 'floodShutoff', kind: 'alarm' };
        } else {
          doc = mergeDemoDoc(doc, getDemoOverride(taplinkerId, now));
        }
        return mergeLinkTapSensorDoc(prev, doc);
      });
      tick();
      const id = setInterval(tick, 1000);
      const onSim = () => tick();
      window.addEventListener(DEMO_SIM_EVENT, onSim);
      return () => { clearInterval(id); window.removeEventListener(DEMO_SIM_EVENT, onSim); };
    }
    const vid = getActiveVehicleId();
    if (!vid) return;
    const ref = doc(db, 'vehicles', vid, 'sensorState', linkTapSensorStateKey(taplinkerId));
    const unsub = onSnapshot(
      ref,
      (snap: any) => setState((prev) => mergeLinkTapSensorDoc(prev, snap.data())),
      () => { /* permission/offline — leave last-known state */ },
    );
    return () => unsub();
  }, [taplinkerId]);

  return state;
}
