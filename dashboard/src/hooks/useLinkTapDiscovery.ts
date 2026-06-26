// LinkTap discovery (Devices → LinkTap Auth) logic, extracted from Settings.tsx (Task 3). Owns the
// non-persisted dropdown/scan UI state (cloud gateway+taplinker lists, scan results/messages, the
// per-field manual-entry toggles) and the two discovery actions: pull devices from the LinkTap cloud
// API, and scan the LAN for a local gateway (Tauri). The persisted gateway/device-id fields stay in
// Settings — their setters are passed in so a successful discovery can auto-fill them.

import { useState } from 'react';
import { nativeFetch } from '../utils/nativeFetch';

type Msg = { text: string; type: 'success' | 'error' } | null;

interface Params {
  cloudUsername: string;
  cloudApiKey: string;
  setGatewayIp: (v: string) => void;
  setGatewayId: (v: string) => void;
  setPrimaryDeviceId: (v: string) => void;
  setSecondaryDeviceId: (v: string) => void;
}

export function useLinkTapDiscovery({
  cloudUsername, cloudApiKey, setGatewayIp, setGatewayId, setPrimaryDeviceId, setSecondaryDeviceId,
}: Params) {
  // Cloud-retrieved options for dropdowns (not persisted)
  const [cloudGateways, setCloudGateways] = useState<{ id: string, name: string }[]>([]);
  const [cloudTaplinkers, setCloudTaplinkers] = useState<{ id: string, name: string, gatewayId: string }[]>([]);
  const [isScanningGateway, setIsScanningGateway] = useState(false);
  const [scanMsg, setScanMsg] = useState<Msg>(null);
  const [scanResults, setScanResults] = useState<string[]>([]);
  // Manual-entry mode for each dropdown (falls back to text input)
  const [gatewayIdManual, setGatewayIdManual] = useState(false);
  const [device1Manual, setDevice1Manual] = useState(false);
  const [device2Manual, setDevice2Manual] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryMsg, setDiscoveryMsg] = useState<Msg>(null);

  const handleRetrieveFromCloud = async () => {
    setIsDiscovering(true);
    setDiscoveryMsg(null);
    try {
      const res = await nativeFetch('https://www.link-tap.com/api/getAllDevices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cloudUsername, apiKey: cloudApiKey })
      });
      const data = JSON.parse(await res.text());
      if (data.result === 'error' && data.message) throw new Error(data.message);

      if (data.devices && data.devices.length > 0) {
        const gateways: { id: string, name: string }[] = [];
        const taplinkers: { id: string, name: string, gatewayId: string }[] = [];

        data.devices.forEach((gw: any) => {
          gateways.push({ id: gw.gatewayId, name: gw.name || gw.gatewayId });
          (gw.taplinker || []).forEach((tap: any) => {
            taplinkers.push({ id: tap.taplinkerId, name: tap.taplinkerName || tap.taplinkerId, gatewayId: gw.gatewayId });
          });
        });

        setCloudGateways(gateways);
        setCloudTaplinkers(taplinkers);

        // Auto-fill for 1–2 gateways; reset to dropdown mode
        if (gateways.length >= 1) { setGatewayId(gateways[0].id); setGatewayIdManual(false); }
        if (taplinkers.length >= 1) { setPrimaryDeviceId(taplinkers[0].id); setDevice1Manual(false); }
        if (taplinkers.length >= 2) { setSecondaryDeviceId(taplinkers[1].id); setDevice2Manual(false); }

        setDiscoveryMsg({ type: 'success', text: `Found ${gateways.length} gateway(s), ${taplinkers.length} device(s).` });
      } else {
        setDiscoveryMsg({ type: 'error', text: 'No devices found or invalid credentials.' });
      }
    } catch (e: any) {
      setDiscoveryMsg({ type: 'error', text: e.message || 'Retrieval failed.' });
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleScanGateway = async () => {
    setIsScanningGateway(true);
    setScanMsg(null);
    setScanResults([]);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const found = await invoke<string[]>('discover_gateway');
      if (found.length === 0) {
        setScanMsg({ text: 'No LinkTap gateway found on your network. Enter IP manually.', type: 'error' });
      } else if (found.length === 1) {
        setGatewayIp(found[0]);
        setScanMsg({ text: `Gateway found at ${found[0]}`, type: 'success' });
      } else {
        setScanResults(found);
        setScanMsg({ text: `${found.length} gateways found — select one below.`, type: 'success' });
      }
    } catch (e: any) {
      setScanMsg({ text: `Scan error: ${e?.message || e}`, type: 'error' });
    }
    setIsScanningGateway(false);
  };

  return {
    cloudGateways, cloudTaplinkers, isScanningGateway, scanMsg, setScanMsg, scanResults, setScanResults,
    gatewayIdManual, setGatewayIdManual, device1Manual, setDevice1Manual, device2Manual, setDevice2Manual,
    isDiscovering, discoveryMsg, handleRetrieveFromCloud, handleScanGateway,
  };
}
