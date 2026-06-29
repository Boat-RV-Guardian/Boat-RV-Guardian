import { useState, useEffect, useRef } from 'react';
import { useCloudConfig } from '../hooks/useCloudConfig';
import { isLocalVehicleConfigDefault, isLocalProfileFresh, applyCloudVehicleConfig, getLocalVehicleConfig } from '../utils/configSync';
import { getActiveVehicleId, getVehiclesMap, saveVehiclesMap, getDeletedVehicleIds, switchVehicle } from '../utils/VehicleManager';
import { getMyRole, ensureOwnerAdmin } from '../utils/sharing';
import { auth, signOut } from '../services/firebase';

export default function SyncModal() {
  const [activeVid, setActiveVid] = useState(getActiveVehicleId());
  const { activeVehicleConfig, configVid, cloudVehicles, userConfig, updateVehicleConfig } = useCloudConfig(activeVid);
  const [showModal, setShowModal] = useState(false);
  const [hasResolved, setHasResolved] = useState(false);
  // Surfaces a cloud-write failure to the user instead of swallowing it in the console (Firestore
  // writes are otherwise fire-and-forget, so a permission/network error was invisible).
  const [syncError, setSyncError] = useState<string | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Adoption (silent pull of the user's cloud vehicles) runs once per login session.
  const adoptedRef = useRef(false);

  // Keep activeVid in sync with local storage if user switches vehicles
  useEffect(() => {
    const handleSettingsUpdated = () => {
      const currentVid = getActiveVehicleId();
      if (currentVid !== activeVid) {
        setActiveVid(currentVid);
        setHasResolved(false); // Reset resolution state when vehicle changes
      }
    };
    window.addEventListener('settings_updated', handleSettingsUpdated);
    return () => window.removeEventListener('settings_updated', handleSettingsUpdated);
  }, [activeVid]);

  // Reset the once-per-session adoption flag whenever the user logs out.
  useEffect(() => {
    if (!auth.currentUser) adoptedRef.current = false;
  }, [userConfig]);

  // Let other modules (e.g. App's user-registry write) surface a cloud-write failure in the banner.
  useEffect(() => {
    const onErr = (e: Event) => { const m = (e as CustomEvent).detail; if (typeof m === 'string') setSyncError(m); };
    window.addEventListener('cloud_sync_error', onErr);
    return () => window.removeEventListener('cloud_sync_error', onErr);
  }, []);

  // Stash the current user's role for the active vehicle so device widgets can gate controls.
  // Defaults to 'admin' when the vehicle isn't cloud-shared (single-user / offline).
  useEffect(() => {
    if (configVid !== activeVid) return;
    const role = (auth.currentUser && activeVehicleConfig && getMyRole(activeVehicleConfig)) || 'admin';
    if (localStorage.getItem('lt_my_role') !== role) {
      localStorage.setItem('lt_my_role', role);
      window.dispatchEvent(new Event('role_updated'));
    }
    // Stash the active vehicle's subscription tier the same way (per-vehicle entitlements, Task 6).
    // Unset/legacy vehicles have no `tier` field → useEntitlements falls back to the grandfathered
    // tier, so this changes no behavior until real tiers are assigned. We store the raw value (may
    // be empty) and let getVehicleTier validate/fallback on read.
    const tier = (activeVehicleConfig && (activeVehicleConfig as any).tier) || '';
    // Also stash the trial expiry (epoch ms) so the Account portal can show trial status (Task 14).
    const trialEnds = (activeVehicleConfig && String((activeVehicleConfig as any).trialEndsAt ?? '')) || '';
    const tierChanged = (localStorage.getItem('lt_vehicle_tier') || '') !== tier;
    const trialChanged = (localStorage.getItem('lt_vehicle_trial_ends') || '') !== trialEnds;
    if (tierChanged) localStorage.setItem('lt_vehicle_tier', tier);
    if (trialChanged) localStorage.setItem('lt_vehicle_trial_ends', trialEnds);
    if (tierChanged || trialChanged) window.dispatchEvent(new Event('tier_updated'));

    // NOTE: the Basic free trial is OPT-IN (owner decision) — a new vehicle defaults to Free and the
    // user starts the 30-day trial explicitly from the Account portal (requestTrial → POST /api/trial,
    // which enforces the per-user/per-vehicle anti-abuse rule). We deliberately do NOT auto-grant here.
  }, [activeVehicleConfig, configVid, activeVid]);

  // Cloud-vehicle reconciliation — runs app-wide (SyncModal is always mounted), so a login
  // from anywhere (first-run popup or Settings) pulls the user's vehicles down.
  //  - Merge: every cloud vehicle is added to the local map (and names kept in sync). This is
  //    what makes the vehicles appear in the picker. Runs on every snapshot.
  //  - Adoption (once per login): if this device's active profile is still the untouched
  //    first-run vehicle, switch to the user's cloud vehicle so their real data loads instead
  //    of a blank local profile. Skipped if local has real edits (those become a new vehicle).
  useEffect(() => {
    if (!auth.currentUser || localStorage.getItem('lt_sync_cloud') === 'false') return;
    if (!cloudVehicles || cloudVehicles.length === 0) return;

    const tombstoned = getDeletedVehicleIds();
    const cloudList = cloudVehicles.filter((cv) => !tombstoned.includes(cv.id));
    if (cloudList.length === 0) return;
    const cloudIds = new Set(cloudList.map((cv) => cv.id));

    // Merge cloud vehicles into the local map (additive + name updates).
    const map = getVehiclesMap();
    let mapChanged = false;
    for (const cv of cloudList) {
      if (!map[cv.id]) {
        map[cv.id] = { id: cv.id, config: cv as Record<string, string> };
        mapChanged = true;
      } else if (map[cv.id].config.lt_vessel_name !== cv.lt_vessel_name) {
        map[cv.id].config.lt_vessel_name = cv.lt_vessel_name;
        mapChanged = true;
      }
    }
    if (mapChanged) saveVehiclesMap(map);

    // Startup vehicle resolution — runs once per login, but only after userConfig has loaded (the
    // user-pref snapshot can arrive a tick after the vehicle list, and we must not decide without it).
    // Modes: 'default' (and unset) → open the user's chosen Default Vehicle on every login;
    // 'last' → keep whatever vehicle was last active on this device. A fresh first-run profile always
    // adopts a real cloud vehicle (and the blank local profile is discarded).
    const currentActive = getActiveVehicleId();
    if (!adoptedRef.current && userConfig) {
      adoptedRef.current = true;
      const localMap = getVehiclesMap();
      const known = (id?: string): id is string => !!id && (cloudIds.has(id) || !!localMap[id]);
      const mode = userConfig.startupMode || 'default';
      const fresh = isLocalProfileFresh() && !cloudIds.has(currentActive);

      let target = currentActive;
      if (mode === 'default' && known(userConfig.activeVehicleId)) {
        target = userConfig.activeVehicleId;          // always open the chosen default
      } else if (!cloudIds.has(currentActive)) {
        target = cloudList[0].id;                      // 'last'/no-pref but current isn't a real cloud vehicle
      }

      if (known(target) && target !== currentActive) {
        switchVehicle(target); // backs up current, loads target, dispatches settings_updated
        // Discard the blank first-run vehicle so the picker isn't cluttered with it.
        const after = getVehiclesMap();
        if (fresh && !cloudIds.has(currentActive) && after[currentActive]) {
          delete after[currentActive];
          saveVehiclesMap(after);
        }
        return;
      }
    }

    if (mapChanged) {
      (window as any).__is_syncing_cloud = true;
      window.dispatchEvent(new Event('settings_updated'));
      (window as any).__is_syncing_cloud = false;
    }
  }, [cloudVehicles, userConfig]);

  useEffect(() => {
    if (!auth.currentUser || hasResolved) return;
    // Critical: only act once the cloud snapshot we're holding actually belongs to the
    // active vehicle. Without this, switching vehicles briefly compares the previous
    // vehicle's cloud data against the new vehicle's local config → false conflict.
    if (configVid !== activeVid) return;
    if (localStorage.getItem('lt_sync_cloud') === 'false') {
      setHasResolved(true);
      return;
    }

    const isLocalDefault = isLocalVehicleConfigDefault();

    if (!activeVehicleConfig || Object.keys(activeVehicleConfig).length === 0) {
      // New cloud vehicle: push local config to cloud, then seed the owner into the `members` map so
      // the vehicle is attributable (the admin Users tab + role resolution read `members`, not just
      // `allowedUsers`). Surface any write failure instead of swallowing it.
      if (!isLocalDefault) {
        updateVehicleConfig(activeVid, getLocalVehicleConfig())
          .then(() => ensureOwnerAdmin(activeVid))
          .catch((e: any) => setSyncError(`Cloud sync failed: ${e?.message || e}`));
      }
      setHasResolved(true);
    } else {
      // Cloud config exists
      if (isLocalDefault) {
        // Local is default, just pull cloud config silently
        (window as any).__is_syncing_cloud = true;
        applyCloudVehicleConfig(activeVehicleConfig);
        (window as any).__is_syncing_cloud = false;
        setHasResolved(true);
      } else {
        // Check for identicalness — skip keys the cloud hasn't seen yet (newly added fields)
        let isIdentical = true;
        const local = getLocalVehicleConfig();
        for (const key of Object.keys(local)) {
          if (activeVehicleConfig[key] === undefined) continue;
          if (local[key] !== activeVehicleConfig[key]) {
            isIdentical = false;
            break;
          }
        }
        
        if (isIdentical) {
          setHasResolved(true);
        } else {
          setShowModal(true);
        }
      }
    }
  }, [activeVehicleConfig, configVid, hasResolved, activeVid]);

  // Live multi-device sync: after the initial conflict resolution, apply a peer's cloud changes to
  // this already-open app, so a device added / setting changed on another device shows up here in
  // real time (useCloudConfig already onSnapshots the active vehicle). Last-write-wins; skipped
  // while one of our own local edits is still pending its debounced push, so we don't clobber what
  // the user is actively changing. Device-local prefs (LOCAL_ONLY_KEYS) aren't touched.
  useEffect(() => {
    if (!auth.currentUser || !hasResolved) return;
    if (localStorage.getItem('lt_sync_cloud') === 'false') return;
    if (configVid !== activeVid) return;
    if (!activeVehicleConfig || Object.keys(activeVehicleConfig).length === 0) return;
    if (autoSaveTimer.current) return; // our own pending change should win

    const local = getLocalVehicleConfig();
    let differs = false;
    for (const key of Object.keys(local)) {
      if (activeVehicleConfig[key] === undefined) continue;
      if (local[key] !== activeVehicleConfig[key]) { differs = true; break; }
    }
    if (!differs) return;

    (window as any).__is_syncing_cloud = true; // suppress the auto-save echo of this applied change
    applyCloudVehicleConfig(activeVehicleConfig);
    (window as any).__is_syncing_cloud = false;
  }, [activeVehicleConfig, configVid, activeVid, hasResolved]);

  // Setup auto-save listener — debounced to avoid hammering Firestore on rapid setting changes.
  // __is_syncing_cloud is set by switchVehicle/deleteVehicle/applyCloudVehicleConfig so this
  // skips events triggered by a vehicle change (which would otherwise write the new vehicle's
  // config onto the old vehicle's cloud record).
  useEffect(() => {
    const handleSettingsUpdated = () => {
      if ((window as any).__is_syncing_cloud) return;
      if (localStorage.getItem('lt_sync_cloud') === 'false') return;
      if (!auth.currentUser || !hasResolved) return;
      // Capture the vehicle id at the moment this event fired, from localStorage (the source
      // of truth), not React state which can lag a switch by a render.
      const vidAtEvent = getActiveVehicleId();
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => {
        // Only write if the active vehicle hasn't changed since the event — otherwise a switch
        // happened mid-debounce and this would target the wrong record.
        if (getActiveVehicleId() !== vidAtEvent) return;
        updateVehicleConfig(vidAtEvent, getLocalVehicleConfig())
          .catch((e: any) => setSyncError(`Cloud sync failed: ${e?.message || e}`));
      }, 2000);
    };
    window.addEventListener('settings_updated', handleSettingsUpdated);
    return () => {
      window.removeEventListener('settings_updated', handleSettingsUpdated);
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [hasResolved, activeVid]);

  if (!showModal) {
    // No conflict modal — but still surface a cloud-sync error if one occurred.
    if (!syncError) return null;
    return (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10000, background: '#7f1d1d', color: '#fff', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.85rem', boxShadow: '0 2px 10px rgba(0,0,0,0.4)' }}>
        <span style={{ flex: 1 }}>⚠️ {syncError}</span>
        <button onClick={() => setSyncError(null)} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' }}>Dismiss</button>
      </div>
    );
  }

  // Keep this device's local settings and stop syncing by signing out — the cloud copy is left
  // untouched (we do NOT overwrite it). The local profile stays exactly as-is.
  const handleLogoutUseLocal = async () => {
    setShowModal(false);
    setHasResolved(true);
    try { await signOut(auth); } catch { /* ignore */ }
  };

  const handleUseCloud = () => {
    (window as any).__is_syncing_cloud = true;
    applyCloudVehicleConfig(activeVehicleConfig || {});
    (window as any).__is_syncing_cloud = false;
    setShowModal(false);
    setHasResolved(true);
  };

  const handleCancel = () => {
    setShowModal(false);
    setHasResolved(true);
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.8)', zIndex: 10000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(5px)'
    }}>
      <div className="glass-card" style={{ maxWidth: '400px', width: '90%' }}>
        <h3 style={{ marginTop: 0, color: 'var(--accent-cyan)' }}>Cloud Sync Conflict</h3>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          This vehicle has a different configuration saved in the cloud than what's on this device. How do you want to resolve it?
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '20px' }}>
          <button className="btn-primary" onClick={handleUseCloud}>
            ☁️ Use the cloud copy
          </button>
          <button className="btn-secondary" onClick={handleLogoutUseLocal}>
            📱 Log out and use local
          </button>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '8px 0' }}></div>
          <button className="btn-secondary" onClick={handleCancel}>
            Cancel and go back
          </button>
        </div>
      </div>
    </div>
  );
}
