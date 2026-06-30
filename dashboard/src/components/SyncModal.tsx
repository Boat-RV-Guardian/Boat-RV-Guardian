import { useState, useEffect, useRef } from 'react';
import { useCloudConfig } from '../hooks/useCloudConfig';
import { isLocalVehicleConfigDefault, isLocalProfileFresh, applyCloudVehicleConfig, getLocalVehicleConfig, cloudConfigDiffers } from '../utils/configSync';
import { getActiveVehicleId, getVehiclesMap, saveVehiclesMap, getDeletedVehicleIds, switchVehicle, wasCreatedThisSession, getSessionCreatedIds, markSessionCreated } from '../utils/VehicleManager';
import { vehiclesToPrune } from '../utils/vehiclePrune';
import { getMyRole, ensureOwnerAdmin } from '../utils/sharing';
import { readPendingMigration, markMigrated } from '../utils/migrateLocalToCloud';
import { auth } from '../services/firebase';

export default function SyncModal() {
  const [activeVid, setActiveVid] = useState(getActiveVehicleId());
  const { activeVehicleConfig, configVid, cloudVehicles, cloudVehiclesLoaded, userConfig, updateVehicleConfig } = useCloudConfig(activeVid);
  const [hasResolved, setHasResolved] = useState(false);
  // Surfaces a cloud-write failure to the user instead of swallowing it in the console (Firestore
  // writes are otherwise fire-and-forget, so a permission/network error was invisible).
  const [syncError, setSyncError] = useState<string | null>(null);
  // Task 15 migrate-local-to-cloud: surfaces a failed (and still-retryable) upload of a staged vehicle.
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const migrationBusyRef = useRef(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Adoption (silent pull of the user's cloud vehicles) runs once per login session.
  const adoptedRef = useRef(false);

  // Task 15 "migrate local account to the cloud" — the POST-sign-in half. The PRE-sign-in half (staging
  // the stash before the sign-in wipe+reload) lives in AccountPanel.tsx / utils/migrateLocalToCloud.ts —
  // read that module's header comment for the full wipe-ordering hazard writeup.
  //
  // This mirrors the EXACT pipeline a brand-new vehicle already uses (VehicleManager.createLocalVehicle
  // → the create-on-cloud-miss branch further down in this file): write each staged vehicle into the
  // local map + markSessionCreated for it FIRST, synchronously, before any network round trip — so the
  // cloud-authoritative prune effect (below) can never mistake an in-flight migrated vehicle for one the
  // cloud simply doesn't know about yet and delete it (the exact bug class PR #34 fixed for normal
  // vehicle creation). Only once a vehicle's `updateVehicleConfig` + `ensureOwnerAdmin` are CONFIRMED do
  // we drop it from the stash (markMigrated) — the stash is the only remaining copy of this data once
  // the wipe has run, so it is never cleared speculatively. On failure, the failing vehicle (and any not
  // yet attempted) stay staged and a retryable error is surfaced via the banner at the bottom of render.
  const runPendingMigration = () => {
    if (migrationBusyRef.current) return;
    const pending = readPendingMigration(localStorage);
    if (!pending) return;
    const ids = Object.keys(pending.vehicles);
    if (ids.length === 0) return;
    migrationBusyRef.current = true;
    setMigrationError(null);

    const map = getVehiclesMap();
    let mapChanged = false;
    for (const vid of ids) {
      if (!map[vid]) { map[vid] = pending.vehicles[vid]; mapChanged = true; }
      markSessionCreated(vid); // protects it from the prune effect below, same as a freshly-created vehicle
    }
    if (mapChanged) saveVehiclesMap(map);
    if (!getActiveVehicleId()) {
      localStorage.setItem('lt_active_vehicle_id', ids[0]);
      mapChanged = true;
    }
    if (mapChanged) {
      (window as any).__is_syncing_cloud = true;
      window.dispatchEvent(new Event('settings_updated')); // flips App's hasVehicle so onboarding clears
      (window as any).__is_syncing_cloud = false;
    }

    (async () => {
      for (const vid of ids) {
        try {
          await updateVehicleConfig(vid, pending.vehicles[vid].config);
          await ensureOwnerAdmin(vid);
          markMigrated(vid, localStorage); // confirmed uploaded — only now is it safe to drop the stash entry
        } catch (e: any) {
          const name = pending.vehicles[vid].config.lt_vessel_name || vid;
          migrationBusyRef.current = false;
          setMigrationError(`Couldn't finish migrating "${name}" to the cloud: ${e?.message || e}. It's still queued on this device — tap Retry once you're back online.`);
          return; // stop here; this vehicle and any not yet attempted stay staged for retry
        }
      }
      migrationBusyRef.current = false;
    })();
  };

  useEffect(() => {
    if (!auth.currentUser) return; // only a real cloud sign-in can run an upload
    runPendingMigration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userConfig]);

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

  // Cloud-authoritative prune: once the cloud vehicle snapshot has LOADED, drop any local vehicle the
  // cloud no longer lists (deleted by an admin / another device), so it can't keep showing — or get
  // resurrected. Protects vehicles created THIS session (maybe unpushed) + tombstoned ids. Runs even
  // when the cloud lists zero (a fully-deleted user). If the active vehicle is pruned, switch to a
  // remaining one (or clear → onboarding).
  useEffect(() => {
    if (!auth.currentUser || localStorage.getItem('lt_sync_cloud') === 'false') return;
    if (!cloudVehiclesLoaded) return; // never prune against a not-yet-loaded list

    const cloudIds = new Set((cloudVehicles || []).map((cv) => cv.id));
    const map = getVehiclesMap();
    const prune = vehiclesToPrune(Object.keys(map), cloudIds, getSessionCreatedIds(), getDeletedVehicleIds());
    if (prune.length === 0) return;

    for (const id of prune) delete map[id];
    saveVehiclesMap(map);

    (window as any).__is_syncing_cloud = true;
    const active = getActiveVehicleId();
    if (!map[active]) {
      const next = Object.keys(map)[0] || '';
      if (next) switchVehicle(next); // loads a surviving vehicle (fires settings_updated)
      else { localStorage.removeItem('lt_active_vehicle_id'); window.dispatchEvent(new Event('settings_updated')); }
    } else {
      window.dispatchEvent(new Event('settings_updated'));
    }
    (window as any).__is_syncing_cloud = false;
  }, [cloudVehicles, cloudVehiclesLoaded]);

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
      // The cloud doc doesn't exist. Push local config to cloud ONLY for a vehicle CREATED THIS SESSION
      // (a genuinely new vehicle being set up) — then seed the owner into `members` (the admin Users tab
      // + role resolution read `members`, not just `allowedUsers`). For a STALE local vehicle whose cloud
      // doc is gone (deleted by an admin / another device), do NOT push — that would RESURRECT a deleted
      // vehicle. The prune effect below removes it from the local list instead.
      if (!isLocalDefault && wasCreatedThisSession(activeVid)) {
        updateVehicleConfig(activeVid, getLocalVehicleConfig())
          .then(() => ensureOwnerAdmin(activeVid))
          .catch((e: any) => setSyncError(`Cloud sync failed: ${e?.message || e}`));
      }
      setHasResolved(true);
    } else {
      // Cloud config exists → the cloud is the source of truth (CLAUDE.md config-sync model,
      // 2026-06-29). If local is the untouched default OR it has diverged from the cloud, pull the
      // cloud copy silently — no prompt. (This replaced the old "Cloud Sync Conflict" modal, whose
      // "log out and use local" option became a lie once applyUserScope started wiping local on
      // sign-out; cloud-wins-on-login matches the no-hybrid model and the live multi-device sync
      // below.) An identical local config needs no pull (it would only fire a redundant
      // settings_updated).
      if (isLocalDefault || cloudConfigDiffers(getLocalVehicleConfig(), activeVehicleConfig)) {
        (window as any).__is_syncing_cloud = true;
        applyCloudVehicleConfig(activeVehicleConfig);
        (window as any).__is_syncing_cloud = false;
      }
      setHasResolved(true);
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

    if (!cloudConfigDiffers(getLocalVehicleConfig(), activeVehicleConfig)) return;

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

  // Cloud-sync conflicts are resolved silently (cloud-wins, above) under the no-hybrid /
  // cloud-as-source-of-truth model — there is no longer a conflict modal. This component now only
  // surfaces a cloud-write error banner (generic sync, or a migrate-local-to-cloud upload) if one occurred.
  const bannerMessage = migrationError || syncError;
  if (!bannerMessage) return null;
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10000, background: '#7f1d1d', color: '#fff', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.85rem', boxShadow: '0 2px 10px rgba(0,0,0,0.4)' }}>
      <span style={{ flex: 1 }}>⚠️ {bannerMessage}</span>
      {migrationError && (
        <button onClick={runPendingMigration} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' }}>Retry</button>
      )}
      <button onClick={() => { setSyncError(null); setMigrationError(null); }} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' }}>Dismiss</button>
    </div>
  );
}
