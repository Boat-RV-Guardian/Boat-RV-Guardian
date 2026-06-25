import { useEffect, useState } from 'react';
import { TIER_FEATURES, getVehicleTier, type Entitlements, type Tier } from '../utils/entitlements';

// Reactive per-vehicle entitlements for the ACTIVE vehicle (open-tasks Task 6). Mirrors the role
// pattern in LinkTapWidget: the active vehicle's tier is stashed in localStorage['lt_vehicle_tier']
// by SyncModal and a 'tier_updated' event is fired when it changes. This hook reads that and returns
// the resolved feature set, re-rendering on 'tier_updated' / 'settings_updated'.
//
// Unset tier falls back to GRANDFATHERED_TIER (via getVehicleTier), so until billing assigns real
// tiers this returns full access and changes no behavior. Gate features off the returned booleans
// (e.g. `entitlements.canControl`) rather than ad-hoc checks.

function readTier(): Tier {
  return getVehicleTier({ tier: localStorage.getItem('lt_vehicle_tier') });
}

export function useEntitlements(): Entitlements {
  const [tier, setTier] = useState<Tier>(readTier);
  useEffect(() => {
    const sync = () => setTier(readTier());
    window.addEventListener('tier_updated', sync);
    window.addEventListener('settings_updated', sync);
    return () => {
      window.removeEventListener('tier_updated', sync);
      window.removeEventListener('settings_updated', sync);
    };
  }, []);
  return TIER_FEATURES[tier];
}
