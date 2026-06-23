import { useState, useEffect, useRef } from 'react';
import { useCloudConfig } from '../hooks/useCloudConfig';
import { isLocalVehicleConfigDefault, isLocalProfileFresh, applyCloudVehicleConfig, getLocalVehicleConfig } from '../utils/configSync';
import { getActiveVehicleId, getVehiclesMap, saveVehiclesMap, getDeletedVehicleIds, switchVehicle } from '../utils/VehicleManager';
import { getMyRole } from '../utils/sharing';
import { auth } from '../services/firebase';

export default function SyncModal() {
  const [activeVid, setActiveVid] = useState(getActiveVehicleId());
  const { activeVehicleConfig, configVid, cloudVehicles, userConfig, updateVehicleConfig } = useCloudConfig(activeVid);
  const [showModal, setShowModal] = useState(false);
  const [hasResolved, setHasResolved] = useState(false);
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

  // Stash the current user's role for the active vehicle so device widgets can gate controls.
  // Defaults to 'admin' when the vehicle isn't cloud-shared (single-user / offline).
  useEffect(() => {
    if (configVid !== activeVid) return;
    const role = (auth.currentUser && activeVehicleConfig && getMyRole(activeVehicleConfig)) || 'admin';
    if (localStorage.getItem('lt_my_role') !== role) {
      localStorage.setItem('lt_my_role', role);
      window.dispatchEvent(new Event('role_updated'));
    }
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

    // Adoption: only if the current device profile is untouched and the active vehicle isn't
    // already one of the cloud vehicles. The flag makes this a one-shot per login so later
    // cloud snapshots can't discard a vehicle the user adds after logging in.
    const currentActive = getActiveVehicleId();
    const shouldAdopt = !adoptedRef.current && isLocalProfileFresh() && !cloudIds.has(currentActive);
    adoptedRef.current = true;

    if (shouldAdopt) {
      const preferred = userConfig?.activeVehicleId && cloudIds.has(userConfig.activeVehicleId)
        ? userConfig.activeVehicleId
        : cloudList[0].id;

      switchVehicle(preferred); // loads the cloud vehicle's config into the active profile

      // Discard the blank first-run vehicle so the picker isn't cluttered with it.
      const after = getVehiclesMap();
      if (currentActive !== preferred && !cloudIds.has(currentActive) && after[currentActive]) {
        delete after[currentActive];
        saveVehiclesMap(after);
      }
      return; // switchVehicle already dispatched settings_updated
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
      // New cloud vehicle: push local config to cloud silently
      if (!isLocalDefault) {
        updateVehicleConfig(activeVid, getLocalVehicleConfig());
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
        updateVehicleConfig(vidAtEvent, getLocalVehicleConfig());
      }, 2000);
    };
    window.addEventListener('settings_updated', handleSettingsUpdated);
    return () => {
      window.removeEventListener('settings_updated', handleSettingsUpdated);
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [hasResolved, activeVid]);

  if (!showModal) return null;

  const handleUseLocal = () => {
    setShowModal(false);
    setHasResolved(true);
    // Fire-and-forget — don't block the UI waiting for Firestore (may be offline)
    updateVehicleConfig(activeVid, getLocalVehicleConfig()).catch(() => {});
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
          We found an existing configuration in the cloud for this vehicle, but you also have local settings. Which one would you like to keep?
        </p>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '20px' }}>
          <button className="btn-primary" onClick={handleUseCloud}>
            ☁️ Use Cloud Settings
          </button>
          <button className="btn-secondary" onClick={handleUseLocal}>
            📱 Use Local Settings (Overwrite Cloud)
          </button>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '8px 0' }}></div>
          <button className="btn-secondary" onClick={handleCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
