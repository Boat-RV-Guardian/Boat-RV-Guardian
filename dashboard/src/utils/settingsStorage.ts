// Centralized read/write for the device-local Settings page values (the `lt_*` / `sh_*` localStorage
// keys). Extracted from Settings.tsx (Task 3) so the key list + defaults live in ONE place instead of
// being duplicated across the initial useState defaults, the `settings_updated` rehydrate effect, and
// the persistence-writer effect — which had already drifted (the rehydrate historically does NOT
// refresh the flood/house/engine/shore notification toggles; that quirk is preserved by the caller,
// not here — `readSettings` returns every field).
//
// Pure + synchronous (localStorage only) so it's unit-testable.

export type AlarmSound = 'siren' | 'beep' | 'off';
export type AlarmRepeat = 'once' | '5' | '15' | '30' | '60';

export interface PersistedSettings {
  syncSettingsCloud: boolean;
  storeHistoryCloud: boolean;
  vesselNickname: string;
  shellyLocalPassword: string;
  webhookUrl: string;
  webhookUser: string;
  webhookKey: string;
  localServerEnabled: boolean;
  localServerBackground: boolean;
  unitSystem: 'metric' | 'imperial';
  timeZone: string;
  normalRunHours: number;
  normalRunMinutes: number;
  normalRunDaily: boolean;
  normalRunVolume: number;
  autoRestartNormal: boolean;
  isCloudPollingActive: boolean;
  isLocalPollingActive: boolean;
  cloudUsername: string;
  cloudApiKey: string;
  gatewayIp: string;
  gatewayId: string;
  primaryDeviceId: string;
  secondaryDeviceId: string;
  shellyServer: string;
  shellyAuthKey: string;
  highPowerIds: string[];
  lowPowerIds: string[];
  floodSensorIds: string[];
  notificationsEnabled: boolean;
  notifyAutoGuard: boolean;
  alertOffline: boolean;
  notifyLowBattery: boolean;
  notifyWatering: boolean;
  notifyFlood: boolean;
  notifyHouseBatt: boolean;
  notifyEngineBatt: boolean;
  notifyShorePower: boolean;
  alarmSound: AlarmSound;
  alarmVolume: number;
  alarmRepeatInterval: AlarmRepeat;
  maxDuration: number;
  autoGuardEnabled: boolean;
  battType: string;
  battSystemV: string;
  battLowVoltage: number;
  battCritVoltage: number;
  battNormalVoltage: number;
  battOverVoltage: number;
  battChargeVoltage: number;
  shoreCritLowV: number;
  shoreLowV: number;
  shoreNormalV: number;
  shoreHighV: number;
  shoreCritHighV: number;
}

// The device's OS-resolved time zone (used when no `lt_tz` is stored), matching the original inline
// default. Falls back to UTC on engines without Intl.supportedValuesOf.
function resolvedDefaultTz(): string {
  return (Intl as any).supportedValuesOf ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
}

// Parse a JSON string-array key, falling back to four empty slots (the Shelly device-id grid shape).
function readIds(key: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key) || '["", "", "", ""]');
  } catch {
    return ['', '', '', ''];
  }
}

// Read every persisted Settings value, applying the same defaults the page's initial state uses.
export function readSettings(): PersistedSettings {
  const g = (k: string) => localStorage.getItem(k);
  return {
    syncSettingsCloud: g('lt_sync_cloud') !== 'false',
    storeHistoryCloud: g('lt_store_history_cloud') === 'true',
    vesselNickname: g('lt_vessel_name') || '',
    shellyLocalPassword: g('sh_local_password') || '',
    webhookUrl: g('sh_webhook_url') || '',
    webhookUser: g('sh_webhook_user') || '',
    webhookKey: g('sh_webhook_key') || '',
    localServerEnabled: g('lt_local_server') === 'true',
    localServerBackground: g('lt_local_server_bg') === 'true',
    unitSystem: (g('lt_unit') as 'metric' | 'imperial') || 'imperial',
    timeZone: g('lt_tz') || resolvedDefaultTz(),
    normalRunHours: Number(g('lt_nr_hrs') || '0'),
    normalRunMinutes: Number(g('lt_nr_mins') || '0'),
    normalRunDaily: g('lt_nr_daily') === 'true',
    normalRunVolume: Number(g('lt_nr_vol') || '10'),
    autoRestartNormal: g('lt_nr_auto') === 'true',
    isCloudPollingActive: g('lt_is_cloud_polling') === 'true',
    isLocalPollingActive: g('lt_is_local_polling') === 'true',
    cloudUsername: g('lt_cloud_user') || '',
    cloudApiKey: g('lt_cloud_key') || '',
    gatewayIp: g('lt_gateway_ip') || '',
    gatewayId: g('lt_gateway_id') || '',
    primaryDeviceId: g('lt_device_id') || '',
    secondaryDeviceId: g('lt_device_id_2') || '',
    shellyServer: g('sh_server') || 'shelly-1-eu.shelly.cloud',
    shellyAuthKey: g('sh_auth_key') || '',
    highPowerIds: readIds('sh_high_power'),
    lowPowerIds: readIds('sh_low_power'),
    floodSensorIds: readIds('sh_flood'),
    notificationsEnabled: g('lt_notif_enabled') !== 'false',
    notifyAutoGuard: g('lt_notif_ag') !== 'false',
    alertOffline: g('lt_alert_offline') !== 'false',
    notifyLowBattery: g('lt_notif_batt') !== 'false',
    notifyWatering: g('lt_notif_water') === 'true',
    notifyFlood: g('lt_notif_flood') !== 'false',
    notifyHouseBatt: g('lt_notif_house_batt') !== 'false',
    notifyEngineBatt: g('lt_notif_engine_batt') !== 'false',
    notifyShorePower: g('lt_notif_shore') !== 'false',
    alarmSound: (g('lt_alarm_sound') as AlarmSound) || 'siren',
    alarmVolume: Number(g('lt_alarm_vol') || '1.0'),
    alarmRepeatInterval: (g('lt_alarm_repeat') as AlarmRepeat) || '30',
    maxDuration: Number(g('lt_max_dur') || '30'),
    autoGuardEnabled: g('lt_auto_guard') !== 'false',
    battType: g('lt_batt_type') || 'flooded',
    battSystemV: g('lt_batt_system_v') || '12',
    battLowVoltage: Number(g('lt_batt_low_v') || '12.2'),
    battCritVoltage: Number(g('lt_batt_crit_v') || '11.8'),
    battNormalVoltage: Number(g('lt_batt_normal_v') || '12.6'),
    battOverVoltage: Number(g('lt_batt_over_v') || '15.0'),
    battChargeVoltage: Number(g('lt_batt_charge_v') || '13.6'),
    shoreCritLowV: Number(g('lt_shore_crit_low_v') || '104'),
    shoreLowV: Number(g('lt_shore_low_v') || '114'),
    shoreNormalV: Number(g('lt_shore_normal_v') || '120'),
    shoreHighV: Number(g('lt_shore_high_v') || '126'),
    shoreCritHighV: Number(g('lt_shore_crit_high_v') || '132'),
  };
}

// Build the local-device list that ProvisionLinkTapModal reads from `lt_local_devices` (shape:
// `{deviceId, name, gatewayId}[]`). The Local Gateway Control section only ever persisted the gateway
// + TapLinker IDs to their own keys, and nothing wrote `lt_local_devices` — so a local-only gateway
// + TapLinker (no LinkTap cloud creds) could be fully configured here yet never show up as a
// selectable valve in the Add-LinkTap-Valve modal ("No TapLinker devices found."). Deriving it here
// from the same fields closes that gap. A Gateway ID is required (local actuation is addressed
// per-gateway); the second TapLinker is optional and de-duped against the first.
export function buildLocalDevices(s: PersistedSettings): { deviceId: string; name: string; gatewayId: string }[] {
  const gatewayId = s.gatewayId.trim();
  if (!gatewayId) return [];
  const out: { deviceId: string; name: string; gatewayId: string }[] = [];
  const d1 = s.primaryDeviceId.trim();
  const d2 = s.secondaryDeviceId.trim();
  if (d1) out.push({ deviceId: d1, name: 'Local TapLinker 1', gatewayId });
  if (d2 && d2 !== d1) out.push({ deviceId: d2, name: 'Local TapLinker 2', gatewayId });
  return out;
}

// Persist every Settings value. Webhook fields are trimmed (matching the original write effect).
// Does NOT dispatch `settings_updated` — the caller owns that (it also guards against re-entry).
export function writeSettings(s: PersistedSettings): void {
  localStorage.setItem('lt_sync_cloud', s.syncSettingsCloud.toString());
  localStorage.setItem('lt_store_history_cloud', s.storeHistoryCloud.toString());
  localStorage.setItem('lt_vessel_name', s.vesselNickname);
  localStorage.setItem('sh_local_password', s.shellyLocalPassword);
  localStorage.setItem('sh_webhook_url', s.webhookUrl.trim());
  localStorage.setItem('sh_webhook_user', s.webhookUser.trim());
  localStorage.setItem('sh_webhook_key', s.webhookKey.trim());
  localStorage.setItem('lt_local_server', s.localServerEnabled.toString());
  localStorage.setItem('lt_local_server_bg', s.localServerBackground.toString());
  localStorage.setItem('lt_unit', s.unitSystem);
  localStorage.setItem('lt_tz', s.timeZone);
  localStorage.setItem('lt_nr_hrs', s.normalRunHours.toString());
  localStorage.setItem('lt_nr_mins', s.normalRunMinutes.toString());
  localStorage.setItem('lt_nr_daily', s.normalRunDaily.toString());
  localStorage.setItem('lt_nr_vol', s.normalRunVolume.toString());
  localStorage.setItem('lt_nr_auto', s.autoRestartNormal.toString());

  localStorage.setItem('lt_is_cloud_polling', s.isCloudPollingActive.toString());
  localStorage.setItem('lt_is_local_polling', s.isLocalPollingActive.toString());
  localStorage.setItem('lt_cloud_user', s.cloudUsername);
  localStorage.setItem('lt_cloud_key', s.cloudApiKey);
  localStorage.setItem('lt_gateway_ip', s.gatewayIp);
  localStorage.setItem('lt_gateway_id', s.gatewayId);
  localStorage.setItem('lt_device_id', s.primaryDeviceId);
  localStorage.setItem('lt_device_id_2', s.secondaryDeviceId);
  // Mirror the local gateway + TapLinker IDs into the shape the Add-LinkTap-Valve modal reads, so
  // local-only valves become selectable there (see buildLocalDevices).
  localStorage.setItem('lt_local_devices', JSON.stringify(buildLocalDevices(s)));

  localStorage.setItem('sh_server', s.shellyServer);
  localStorage.setItem('sh_auth_key', s.shellyAuthKey);
  localStorage.setItem('sh_high_power', JSON.stringify(s.highPowerIds));
  localStorage.setItem('sh_low_power', JSON.stringify(s.lowPowerIds));
  localStorage.setItem('sh_flood', JSON.stringify(s.floodSensorIds));

  localStorage.setItem('lt_notif_enabled', s.notificationsEnabled.toString());
  localStorage.setItem('lt_notif_ag', s.notifyAutoGuard.toString());
  localStorage.setItem('lt_alert_offline', s.alertOffline.toString());
  localStorage.setItem('lt_notif_batt', s.notifyLowBattery.toString());
  localStorage.setItem('lt_notif_water', s.notifyWatering.toString());
  localStorage.setItem('lt_notif_flood', s.notifyFlood.toString());
  localStorage.setItem('lt_notif_house_batt', s.notifyHouseBatt.toString());
  localStorage.setItem('lt_notif_engine_batt', s.notifyEngineBatt.toString());
  localStorage.setItem('lt_notif_shore', s.notifyShorePower.toString());
  localStorage.setItem('lt_alarm_sound', s.alarmSound);
  localStorage.setItem('lt_alarm_vol', s.alarmVolume.toString());
  localStorage.setItem('lt_alarm_repeat', s.alarmRepeatInterval);

  localStorage.setItem('lt_max_dur', s.maxDuration.toString());
  localStorage.setItem('lt_auto_guard', s.autoGuardEnabled.toString());

  localStorage.setItem('lt_batt_type', s.battType);
  localStorage.setItem('lt_batt_system_v', s.battSystemV);
  localStorage.setItem('lt_batt_low_v', s.battLowVoltage.toString());
  localStorage.setItem('lt_batt_crit_v', s.battCritVoltage.toString());
  localStorage.setItem('lt_batt_normal_v', s.battNormalVoltage.toString());
  localStorage.setItem('lt_batt_over_v', s.battOverVoltage.toString());
  localStorage.setItem('lt_batt_charge_v', s.battChargeVoltage.toString());
  localStorage.setItem('lt_shore_crit_low_v', s.shoreCritLowV.toString());
  localStorage.setItem('lt_shore_low_v', s.shoreLowV.toString());
  localStorage.setItem('lt_shore_normal_v', s.shoreNormalV.toString());
  localStorage.setItem('lt_shore_high_v', s.shoreHighV.toString());
  localStorage.setItem('lt_shore_crit_high_v', s.shoreCritHighV.toString());
}

// One React state setter per persisted field. Declared as a mapped type over PersistedSettings so
// that a NEW field added to PersistedSettings is a COMPILE error at the call site until a setter is
// supplied — which is exactly the drift that silently dropped the flood/house/engine/shore
// notification toggles from the Settings `settings_updated` rehydrate before this existed.
export type SettingsSetters = {
  [K in keyof PersistedSettings]: (value: PersistedSettings[K]) => void;
};

// Apply every persisted field to its corresponding setter. Iterating the full key set (rather than a
// hand-maintained list of `setX(s.x)` lines) means a field can never again be persisted-but-not-
// rehydrated. Used by the Settings page's `settings_updated` handler.
export function applyPersistedSettings(s: PersistedSettings, setters: SettingsSetters): void {
  for (const key of Object.keys(s) as (keyof PersistedSettings)[]) {
    (setters[key] as (value: PersistedSettings[keyof PersistedSettings]) => void)(s[key]);
  }
}
