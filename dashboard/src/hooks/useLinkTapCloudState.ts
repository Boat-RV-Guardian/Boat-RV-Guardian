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

export function useLinkTapCloudState(taplinkerId: string | undefined | null): LinkTapCloudState | null {
  const [state, setState] = useState<LinkTapCloudState | null>(null);

  useEffect(() => {
    if (!taplinkerId) return;
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
