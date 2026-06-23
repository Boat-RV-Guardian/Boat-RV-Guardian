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
  lt_batt_low_v: '11.9',
  lt_batt_crit_v: '11.5',
  lt_batt_charge_v: '13.2',
  lt_batt_over_v: '15.5',
  lt_shore_crit_low_v: '95',
  lt_shore_low_v: '100',
  lt_shore_high_v: '128',
  lt_shore_crit_high_v: '135',
  lt_vessel_name: 'New Vehicle',
  sh_local_password: '', // per-vehicle Shelly local device password (auto-generated on create)
  lt_devices: '[]'
};

export const VEHICLE_KEYS = Object.keys(VEHICLE_DEFAULT_CONFIG);

// Deployed Cloudflare worker that relays Shelly sensor alerts → FCM push. Used as the default
// when the user hasn't overridden it in Settings.
export const DEFAULT_WORKER_URL = 'https://boat-rv-guardian-webhooks.jgearinger.workers.dev';

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
