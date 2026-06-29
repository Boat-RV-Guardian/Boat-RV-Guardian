export const LOCAL_ONLY_KEYS = [
  'lt_sync_cloud',
  'lt_unit',
  'lt_tz',
  'lt_is_cloud_polling',
  'lt_is_local_polling',
  'lt_alert_offline',
  'lt_notif_enabled',
  'lt_alarm_sound',
  'lt_alarm_vol',
  'lt_alarm_repeat',
  'lt_notif_ag',
  'lt_notif_batt',
  'lt_notif_water',
  'lt_notif_flood',
  'lt_notif_house_batt',
  'lt_notif_engine_batt',
  'lt_notif_shore'
];

export const VEHICLE_DEFAULT_CONFIG: Record<string, string> = {
  lt_cloud_user: '',
  lt_cloud_key: '',
  lt_gateway_ip: '',
  lt_gateway_id: '',
  lt_device_id: '',
  lt_device_id_2: '',
  lt_store_history_cloud: 'false',
  lt_refresh: '5',
  lt_auto_guard: 'true',
  lt_nr_hrs: '0',
  lt_nr_mins: '0',
  lt_nr_daily: 'false',
  lt_nr_vol: '10',
  lt_nr_auto: 'false',
  lt_maxflow: '15',
  lt_maxdur: '30',
  lt_reset_time: '12:00',
  lt_enable_history: 'true',
  lt_input_dur: '15',
  lt_input_vol: '50',
  lt_del_mins: '0',
  lt_del_secs: '15',
  lt_wash_dur: '30',
  lt_wd_resume: 'false',
  lt_norm_daily: 'false',
  lt_norm_hrs: '24',
  lt_norm_mins: '0',
  lt_norm_vol: '300',
  lt_auto_restart: 'false',
  lt_target_dur: '0',
  lt_target_vol: '0',
  lt_batt_type: 'flooded',
  lt_batt_system_v: '12',
  lt_batt_low_v: '12.2',
  lt_batt_crit_v: '11.8',
  lt_batt_normal_v: '12.6',
  lt_batt_charge_v: '13.6',
  lt_batt_over_v: '15.0',
  lt_shore_crit_low_v: '104',
  lt_shore_low_v: '114',
  lt_shore_normal_v: '120',
  lt_shore_high_v: '126',
  lt_shore_crit_high_v: '132',
  lt_vessel_name: 'New Vehicle',
  lt_vehicle_type: '',   // 'boat' | 'rv' (chosen at creation; '' = unspecified/legacy)
  sh_local_password: '', // per-vehicle Shelly local device password (auto-generated on create)
  sh_webhook_url: '',    // per-vehicle custom cloud worker URL (blank ⇒ DEFAULT_WORKER_URL)
  sh_webhook_user: '',   // username for a self-hosted cloud server (issued by its admin page; Task 7)
  sh_webhook_key: '',    // API key for a self-hosted cloud server (paired with sh_webhook_user)
  tier: '',              // per-vehicle subscription tier ('' ⇒ grandfathered; see utils/entitlements)
  sh_sms_prefs: '',      // per-vehicle SMS/voice alert prefs (JSON {phones,events}; '' ⇒ none) — Premium
  sh_api_tokens: '',     // per-vehicle integration API tokens (JSON ApiToken[]; '' ⇒ none) — Premium
  lt_devices: '[]'
};

export const VEHICLE_KEYS = Object.keys(VEHICLE_DEFAULT_CONFIG);

// Deployed Cloudflare worker that relays Shelly sensor alerts → FCM push. Used as the default
// when the user hasn't overridden it in Settings.
export const DEFAULT_WORKER_URL = 'https://boat-rv-guardian-webhooks.jgearinger.workers.dev';

// --- One-time threshold migration (marine/RV default refresh) ---------------------------------
// Vehicles created before the default refresh still hold the OLD shipped threshold values. Replace
// ONLY values that exactly equal an old default (i.e. the user never touched them) with the new
// default; any other value is treated as a deliberate customization and left alone. Value-matching
// makes this idempotent — re-running it does nothing once the old values are gone. (lt_*_normal_v
// are NEW keys with no old value, so they just adopt their default; no migration entry needed.)
const THRESHOLD_MIGRATIONS: Record<string, { old: string; to: string }> = {
  lt_batt_low_v:        { old: '11.9', to: '12.2' },
  lt_batt_crit_v:       { old: '11.5', to: '11.8' },
  lt_batt_charge_v:     { old: '13.2', to: '13.6' },
  lt_batt_over_v:       { old: '15.5', to: '15.0' },
  lt_shore_crit_low_v:  { old: '95',   to: '104' },
  lt_shore_low_v:       { old: '100',  to: '114' },
  lt_shore_high_v:      { old: '128',  to: '126' },
  lt_shore_crit_high_v: { old: '135',  to: '132' },
};

function migrateThresholdMap(get: (k: string) => string | null | undefined, set: (k: string, v: string) => void): boolean {
  let changed = false;
  for (const [key, m] of Object.entries(THRESHOLD_MIGRATIONS)) {
    if (get(key) === m.old) { set(key, m.to); changed = true; }
  }
  return changed;
}

// Correct the active vehicle's flat localStorage threshold keys. Idempotent; safe to call on every
// cloud pull (so old values pulled from the cloud get corrected and re-synced). Returns true if any
// value changed.
export function migrateFlatThresholds(): boolean {
  return migrateThresholdMap((k) => localStorage.getItem(k), (k, v) => localStorage.setItem(k, v));
}

// One-time (flag-gated) sweep that also fixes vehicles stored in the lt_vehicles map but not active.
// The flat-key migration above keeps the ACTIVE vehicle correct on every cloud pull; this catches
// the rest (e.g. offline-only vehicles you switch to later). Call once at app startup.
export function migrateAllVehiclesThresholds(): void {
  try {
    if (localStorage.getItem('lt_thresholds_migrated_v2') === 'true') return;
    let anyChanged = migrateFlatThresholds();
    const raw = localStorage.getItem('lt_vehicles');
    if (raw) {
      const map = JSON.parse(raw);
      let mapChanged = false;
      for (const vid of Object.keys(map)) {
        const cfg = map[vid] && map[vid].config;
        if (!cfg) continue;
        if (migrateThresholdMap((k) => cfg[k], (k, v) => { cfg[k] = v; })) mapChanged = true;
      }
      if (mapChanged) { localStorage.setItem('lt_vehicles', JSON.stringify(map)); anyChanged = true; }
    }
    localStorage.setItem('lt_thresholds_migrated_v2', 'true');
    if (anyChanged) window.dispatchEvent(new Event('settings_updated'));
  } catch { /* non-fatal */ }
}

export function isLocalVehicleConfigDefault(): boolean {
  for (const key of VEHICLE_KEYS) {
    const val = localStorage.getItem(key);
    if (val !== null && val !== VEHICLE_DEFAULT_CONFIG[key]) {
      return false; // Found a non-default value
    }
  }
  return true;
}

// Whether the current root profile is "untouched" — all defaults except the vessel name,
// which is auto-populated on first run ("My First Vessel") and therefore not a signal of
// real user data. Used on login to decide whether it's safe to silently adopt the cloud.
// lt_vessel_name (auto-named) and sh_local_password (auto-generated per vehicle) are not signals
// of real user data, so they must not make a brand-new profile look "non-fresh".
const FRESHNESS_IGNORE_KEYS = ['lt_vessel_name', 'sh_local_password'];
export function isLocalProfileFresh(): boolean {
  for (const key of VEHICLE_KEYS) {
    if (FRESHNESS_IGNORE_KEYS.includes(key)) continue;
    const val = localStorage.getItem(key);
    if (val !== null && val !== VEHICLE_DEFAULT_CONFIG[key]) {
      return false;
    }
  }
  return true;
}

export function getLocalVehicleConfig(): Record<string, any> {
  const config: Record<string, any> = {};
  for (const key of VEHICLE_KEYS) {
    const val = localStorage.getItem(key);
    config[key] = val !== null ? val : VEHICLE_DEFAULT_CONFIG[key];
  }
  return config;
}

export function applyCloudVehicleConfig(config: Record<string, any>) {
  for (const key of VEHICLE_KEYS) {
    // Fall back to default for keys the cloud hasn't seen yet (new fields added after initial sync)
    const val = config[key] !== undefined ? config[key] : VEHICLE_DEFAULT_CONFIG[key];
    localStorage.setItem(key, val as string);
  }

  // Correct any OLD-default thresholds just pulled from the cloud, so the active vehicle adopts the
  // new marine/RV standards (and the corrected values fold into the map + re-sync below).
  migrateFlatThresholds();

  // Keep the vehicles map in sync so Settings re-renders correctly after this fires settings_updated
  try {
    const activeId = localStorage.getItem('lt_active_vehicle_id');
    if (activeId) {
      const raw = localStorage.getItem('lt_vehicles');
      const map = raw ? JSON.parse(raw) : {};
      if (map[activeId]) {
        const updatedConfig: Record<string, string> = {};
        for (const key of VEHICLE_KEYS) {
          updatedConfig[key] = localStorage.getItem(key) || VEHICLE_DEFAULT_CONFIG[key];
        }
        map[activeId].config = updatedConfig;
        localStorage.setItem('lt_vehicles', JSON.stringify(map));
      }
    }
  } catch (e) { /* non-fatal */ }

  window.dispatchEvent(new Event('settings_updated'));
}
