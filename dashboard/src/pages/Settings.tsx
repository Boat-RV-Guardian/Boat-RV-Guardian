import { useState, useEffect, useRef } from 'react';

import { getActiveVehicleId, getVehiclesMap, switchVehicle, addNewVehicle, deleteVehicle, getDevices, updateDevice, type DeviceConfig } from '../utils/VehicleManager';
import { getLocalVehicleConfig } from '../utils/configSync';
import { nativeFetch } from '../utils/nativeFetch';
import { useCloudConfig } from '../hooks/useCloudConfig';
import { useVehicleSharing } from '../hooks/useVehicleSharing';
import { useLinkTapDiscovery } from '../hooks/useLinkTapDiscovery';
import { deviceLocalHost, findVoltmeterId } from '../utils/shellyDevice';
import ProvisionShellyModal from '../components/ProvisionShellyModal';
import ProvisionLinkTapModal from '../components/ProvisionLinkTapModal';
import DeleteAccountButton from '../components/DeleteAccountButton';
import { auth } from '../services/firebase';
import LocalServerPanel from './settings/LocalServerPanel';
import VehiclesPanel from './settings/VehiclesPanel';
import AccountPanel from './settings/AccountPanel';
import DeviceConfigPanel from './settings/DeviceConfigPanel';
import DevicePreferencesPanel from './settings/DevicePreferencesPanel';
import AddDevicePanel from './settings/AddDevicePanel';
import SoftwareUpdatesPanel from './settings/SoftwareUpdatesPanel';
import NotificationsPanel from './settings/NotificationsPanel';
import AdvancedDeviceSettingsPanel from './settings/AdvancedDeviceSettingsPanel';
import FriendsPanel from './settings/FriendsPanel';
import LinkTapAuthPanel from './settings/LinkTapAuthPanel';
import SettingsModals from './settings/SettingsModals';
import { useEntitlements } from '../hooks/useEntitlements';
import { getBatteryThresholds } from '../utils/batteryPresets';
import { readSettings, writeSettings, applyPersistedSettings } from '../utils/settingsStorage';
import { isLocalMode } from '../utils/userScope';
import { useAppUpdater } from '../hooks/useAppUpdater';

const APP_VERSION = '1.0.49';

export default function Settings({ user }: { user: any }) {
  const [showLogin, setShowLogin] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'accounts' | 'devices' | 'friends' | 'updates'>('general');
  const [devicesTab, setDevicesTab] = useState<'add' | 'config' | 'advanced' | 'auth'>('config');
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  // Real signed-update path on Tauri desktop (Task 13 part 3); the GitHub-tag check above/below stays
  // as the version-badge signal on every platform (web/Capacitor included) and as this hook's fallback
  // when it reports 'unsupported' or 'error'.
  const appUpdater = useAppUpdater();

  useEffect(() => {
    fetch('https://api.github.com/repos/Boat-RV-Guardian/Boat-RV-Guardian/releases/latest')
      .then(res => res.json())
      .then(data => {
        if (data && data.tag_name) {
          const version = data.tag_name.replace(/^v/, '');
          setLatestVersion(version);
        }
      })
      .catch(err => console.error("Failed to fetch latest version:", err));
    appUpdater.checkForUpdate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Vehicle Management State
  const [activeVid, setActiveVid] = useState(() => getActiveVehicleId());
  const [vehiclesMap, setVehiclesMap] = useState(() => getVehiclesMap());
  const [selectedVid, setSelectedVid] = useState(() => getActiveVehicleId());

  // Vehicle Modals State
  const [showNewVehicleModal, setShowNewVehicleModal] = useState(false);
  const [newVehicleNameInput, setNewVehicleNameInput] = useState('');
  const [newVehicleType, setNewVehicleType] = useState<'' | 'boat' | 'rv'>('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmChecked, setDeleteConfirmChecked] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);

  // Cross-device sync
  // Cloud-vehicle reconciliation lives in SyncModal (always mounted) so it works app-wide.
  // Settings only needs the cloud write helpers; its vehiclesMap refreshes via settings_updated.
  const { cloudVehicles, userConfig, updateVehicleConfig, updateUserConfig, deleteVehicleConfig, hardDeleteVehicleConfig } = useCloudConfig(null);
  const [defaultVidSaving, setDefaultVidSaving] = useState(false);

  // --- Friends / Sharing (Friends tab): state, derived roles/members + handlers live in the hook ---
  const {
    pendingInvites, shareEmail, setShareEmail, shareRole, setShareRole, shareMsg, setShareMsg,
    lastInvite, sentInvites, friendsBusy,
    sharedWithMe, activeCloudVehicle, isActiveAdmin, activeVehicleName, activeMembers,
    activeOwner, isActiveOwner,
    handleCreateInvite, handleAcceptInvite, handleDeclineInvite, handleRemoveMember,
    handleCancelInvite, handleLeaveVehicle, handleTransferOwnership,
  } = useVehicleSharing({ user, cloudVehicles, activeVid, activeTab });

  // Sync Toggles
  const [syncSettingsCloud, setSyncSettingsCloud] = useState(() => localStorage.getItem('lt_sync_cloud') !== 'false');
  const [storeHistoryCloud, setStoreHistoryCloud] = useState(() => localStorage.getItem('lt_store_history_cloud') === 'true');
  // Active vehicle's entitlements (per-vehicle tier). Cloud history is a Basic+ feature. Legacy/unset
  // vehicles grandfather to premium, so this gates nothing until real tiers are assigned.
  const entitlements = useEntitlements();
  const canCloudHistory = entitlements.historyRetentionDays > 0;

  // App Settings State
  const [unitSystem, setUnitSystem] = useState<'metric' | 'imperial'>(() => localStorage.getItem('lt_unit') as 'metric' | 'imperial' || 'imperial');
  const volUnit = unitSystem === 'imperial' ? 'Gallons' : 'Liters';
  const [timeZone, setTimeZone] = useState(() => localStorage.getItem('lt_tz') || ((Intl as any).supportedValuesOf ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'));
  const [vesselNickname, setVesselNickname] = useState(() => localStorage.getItem('lt_vessel_name') || '');
  // Per-vehicle Boat/RV type. Managed directly (not via the synced-settings machinery): writeSettings
  // doesn't touch lt_vehicle_type, getLocalVehicleConfig syncs it, and switchVehicle backs it up.
  const [vehicleType, setVehicleType] = useState<'' | 'boat' | 'rv'>(() => (localStorage.getItem('lt_vehicle_type') as '' | 'boat' | 'rv') || '');
  const [isEditingType, setIsEditingType] = useState(false);
  const changeVehicleType = (t: 'boat' | 'rv') => {
    localStorage.setItem('lt_vehicle_type', t);
    setVehicleType(t);
    setIsEditingType(false);
    window.dispatchEvent(new Event('settings_updated')); // persist + cloud-sync like any other config edit
  };
  const [shellyLocalPassword, setShellyLocalPassword] = useState(() => localStorage.getItem('sh_local_password') || '');
  const [showShellyPw, setShowShellyPw] = useState(false);
  // Shelly local password is read-only until "Edit"; on "Save" we confirm + push to every device.
  const [isEditingShellyPw, setIsEditingShellyPw] = useState(false);
  const [shellyPwDraft, setShellyPwDraft] = useState('');
  const [showPwChangeModal, setShowPwChangeModal] = useState(false);
  const [pwChangeBusy, setPwChangeBusy] = useState(false);
  const [pwChangeMsg, setPwChangeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Custom cloud worker URL — per-vehicle config; blank ⇒ DEFAULT_WORKER_URL is used. Hidden behind
  // a toggle (only relevant for users running their own cloud server).
  const [webhookUrl, setWebhookUrl] = useState(() => localStorage.getItem('sh_webhook_url') || '');
  // Credentials for a self-hosted cloud server (issued by its admin page — see Task 7). Sent to the
  // custom server to authenticate; ignored for the default hosted worker.
  const [webhookUser, setWebhookUser] = useState(() => localStorage.getItem('sh_webhook_user') || '');
  const [webhookKey, setWebhookKey] = useState(() => localStorage.getItem('sh_webhook_key') || '');
  const [showWebhookKey, setShowWebhookKey] = useState(false);
  // "Advanced Vehicle Settings" group (holds the Custom Cloud Server URL etc.) — collapsed by default.
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Local Server Options (device-local). The app can act as a local listener so sleepy Shelly
  // sensors can push events straight to it with no internet. Background mode (Android foreground
  // service) keeps it alive when the app isn't open, at the cost of a persistent notification.
  // Defaults OFF for new installs (hosted cloud is the default path; the local server is an opt-in
  // for self-host — see open-tasks Task 5). A one-time migration in main.tsx preserves the old
  // default-ON for EXISTING installs, so this `=== 'true'` read is safe.
  const [localServerEnabled, setLocalServerEnabled] = useState(() => localStorage.getItem('lt_local_server') === 'true');
  const [localServerBackground, setLocalServerBackground] = useState(() => localStorage.getItem('lt_local_server_bg') === 'true');

  // Normal Run Profile Config
  const [normalRunHours, setNormalRunHours] = useState(() => Number(localStorage.getItem('lt_nr_hrs') || '0'));
  const [normalRunMinutes, setNormalRunMinutes] = useState(() => Number(localStorage.getItem('lt_nr_mins') || '0'));
  const [normalRunDaily, setNormalRunDaily] = useState(() => localStorage.getItem('lt_nr_daily') === 'true');
  const [normalRunVolume, setNormalRunVolume] = useState(() => Number(localStorage.getItem('lt_nr_vol') || '10'));
  const [autoRestartNormal, setAutoRestartNormal] = useState(() => localStorage.getItem('lt_nr_auto') === 'true');

  // Hardware Connections
  const [isCloudPollingActive, setIsCloudPollingActive] = useState(() => localStorage.getItem('lt_is_cloud_polling') === 'true');
  const [isLocalPollingActive, setIsLocalPollingActive] = useState(() => localStorage.getItem('lt_is_local_polling') === 'true');
  const [cloudUsername, setCloudUsername] = useState(() => localStorage.getItem('lt_cloud_user') || '');
  const [cloudApiKey, setCloudApiKey] = useState(() => localStorage.getItem('lt_cloud_key') || '');
  const [showCloudApiKey, setShowCloudApiKey] = useState(false);
  // Local gateway config — always-visible fields
  const [gatewayIp, setGatewayIp] = useState(() => localStorage.getItem('lt_gateway_ip') || '');
  const [gatewayId, setGatewayId] = useState(() => localStorage.getItem('lt_gateway_id') || '');
  const [primaryDeviceId, setPrimaryDeviceId] = useState(() => localStorage.getItem('lt_device_id') || '');
  const [secondaryDeviceId, setSecondaryDeviceId] = useState(() => localStorage.getItem('lt_device_id_2') || '');
  // LinkTap discovery (cloud retrieve + LAN scan): non-persisted dropdown/scan state + the two
  // discovery actions live in the hook. The persisted gateway/device-id setters are passed in so a
  // successful discovery can auto-fill them.
  const {
    cloudGateways, cloudTaplinkers, isScanningGateway, scanMsg, setScanMsg, scanResults, setScanResults,
    gatewayIdManual, setGatewayIdManual, device1Manual, setDevice1Manual, device2Manual, setDevice2Manual,
    isDiscovering, discoveryMsg, handleRetrieveFromCloud, handleScanGateway,
  } = useLinkTapDiscovery({ cloudUsername, cloudApiKey, setGatewayIp, setGatewayId, setPrimaryDeviceId, setSecondaryDeviceId });

  // Shelly Hardware Connections
  const [shellyServer, setShellyServer] = useState(() => localStorage.getItem('sh_server') || 'shelly-1-eu.shelly.cloud');
  const [shellyAuthKey, setShellyAuthKey] = useState(() => localStorage.getItem('sh_auth_key') || '');
  const [highPowerIds, setHighPowerIds] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('sh_high_power') || '["", "", "", ""]'); } catch { return ["", "", "", ""]; } });
  const [lowPowerIds, setLowPowerIds] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('sh_low_power') || '["", "", "", ""]'); } catch { return ["", "", "", ""]; } });
  const [floodSensorIds, setFloodSensorIds] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('sh_flood') || '["", "", "", ""]'); } catch { return ["", "", "", ""]; } });
  
  // Modals & Device State
  const [isProvisionModalOpen, setIsProvisionModalOpen] = useState(false);
  const [isProvisionLinkTapModalOpen, setIsProvisionLinkTapModalOpen] = useState(false);
  const [devices, setDevices] = useState<DeviceConfig[]>(() => getDevices());

  // Per-device settings panel
  const [expandedDeviceId, setExpandedDeviceId] = useState<string | null>(null);
  const [fwBusy, setFwBusy] = useState(false);
  const [fwMsg, setFwMsg] = useState('');
  const [devNormalHrs, setDevNormalHrs] = useState(24);
  const [devNormalMins, setDevNormalMins] = useState(0);
  const [devNormalDaily, setDevNormalDaily] = useState(false);
  const [devNormalVol, setDevNormalVol] = useState(300);
  const [devAutoRestart, setDevAutoRestart] = useState(false);

  // Battery chemistry preset + system voltage (drives the threshold defaults below).
  const [battType, setBattType] = useState(() => localStorage.getItem('lt_batt_type') || 'flooded');
  const [battSystemV, setBattSystemV] = useState(() => localStorage.getItem('lt_batt_system_v') || '12');
  // Battery Voltage Thresholds (defaults = marine/RV 12 V lead-acid resting SoC + charging norms)
  const [battLowVoltage, setBattLowVoltage] = useState(() => Number(localStorage.getItem('lt_batt_low_v') || '12.2'));
  const [battCritVoltage, setBattCritVoltage] = useState(() => Number(localStorage.getItem('lt_batt_crit_v') || '11.8'));
  const [battNormalVoltage, setBattNormalVoltage] = useState(() => Number(localStorage.getItem('lt_batt_normal_v') || '12.6'));
  const [battOverVoltage, setBattOverVoltage] = useState(() => Number(localStorage.getItem('lt_batt_over_v') || '15.0'));
  const [battChargeVoltage, setBattChargeVoltage] = useState(() => Number(localStorage.getItem('lt_batt_charge_v') || '13.6'));
  // Shore Power Voltage Thresholds (defaults = 120 V nominal with EMS-style ±5% warn / cutoff bands)
  const [shoreCritLowV, setShoreCritLowV] = useState(() => Number(localStorage.getItem('lt_shore_crit_low_v') || '104'));
  const [shoreLowV, setShoreLowV] = useState(() => Number(localStorage.getItem('lt_shore_low_v') || '114'));
  const [shoreNormalV, setShoreNormalV] = useState(() => Number(localStorage.getItem('lt_shore_normal_v') || '120'));
  const [shoreHighV, setShoreHighV] = useState(() => Number(localStorage.getItem('lt_shore_high_v') || '126'));
  const [shoreCritHighV, setShoreCritHighV] = useState(() => Number(localStorage.getItem('lt_shore_crit_high_v') || '132'));

  // Apply a battery chemistry/system-voltage preset to the five threshold fields. 'custom' keeps
  // whatever is currently set (manual edit). Called from the two dropdowns.
  const applyBatteryPreset = (type: string, sysV: string) => {
    setBattType(type);
    setBattSystemV(sysV);
    const preset = getBatteryThresholds(type, sysV);
    if (preset) {
      setBattCritVoltage(preset.crit);
      setBattLowVoltage(preset.low);
      setBattNormalVoltage(preset.normal);
      setBattChargeVoltage(preset.charge);
      setBattOverVoltage(preset.over);
    }
  };

  // Notifications & Alarms
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => localStorage.getItem('lt_notif_enabled') !== 'false');
  const [notifyAutoGuard, setNotifyAutoGuard] = useState(() => localStorage.getItem('lt_notif_ag') !== 'false');
  const [alertOffline, setAlertOffline] = useState(() => localStorage.getItem('lt_alert_offline') !== 'false');
  const [notifyLowBattery, setNotifyLowBattery] = useState(() => localStorage.getItem('lt_notif_batt') !== 'false');
  const [notifyWatering, setNotifyWatering] = useState(() => localStorage.getItem('lt_notif_water') === 'true');
  const [notifyFlood, setNotifyFlood] = useState(() => localStorage.getItem('lt_notif_flood') !== 'false');
  const [notifyHouseBatt, setNotifyHouseBatt] = useState(() => localStorage.getItem('lt_notif_house_batt') !== 'false');
  const [notifyEngineBatt, setNotifyEngineBatt] = useState(() => localStorage.getItem('lt_notif_engine_batt') !== 'false');
  const [notifyShorePower, setNotifyShorePower] = useState(() => localStorage.getItem('lt_notif_shore') !== 'false');
  const [alarmSound, setAlarmSound] = useState<'siren'|'beep'|'off'>(() => (localStorage.getItem('lt_alarm_sound') as any) || 'siren');
  const [alarmVolume, setAlarmVolume] = useState(() => Number(localStorage.getItem('lt_alarm_vol') || '1.0'));
  const [alarmRepeatInterval, setAlarmRepeatInterval] = useState<'once'|'5'|'15'|'30'|'60'>(() => (localStorage.getItem('lt_alarm_repeat') as any) || '30');

  // Safety Limits
  const [maxDuration, setMaxDuration] = useState(() => Number(localStorage.getItem('lt_max_dur') || '30'));
  const [autoGuardEnabled, setAutoGuardEnabled] = useState(() => localStorage.getItem('lt_auto_guard') !== 'false');

  // Guard to prevent Settings.tsx from re-processing its own dispatched settings_updated events.
  // window.dispatchEvent is synchronous, so setting true before dispatch and false after covers the window.
  const syncDispatchRef = useRef(false);

  // Connection Engine Cross-Communication
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'mock' | 'connecting'>('disconnected');
  // (isDiscovering / discoveryMsg + the LinkTap discovery actions now live in useLinkTapDiscovery)

  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const [manualSyncMsg, setManualSyncMsg] = useState<{text: string, type: 'success' | 'error'} | null>(null);

  useEffect(() => {
    const handleSettingsUpdate = () => {
      // Skip events we dispatched ourselves — prevents the sync effect from looping
      if (syncDispatchRef.current) return;

      // Re-hydrate local state from localStorage if a background update happened. Defaults + key
      // list live in utils/settingsStorage (readSettings); applyPersistedSettings fans every field
      // out to its setter so nothing can be persisted-but-not-rehydrated (this previously dropped
      // the flood/house/engine/shore notification toggles — see settingsStorage.ts).
      const s = readSettings();
      applyPersistedSettings(s, {
        syncSettingsCloud: setSyncSettingsCloud,
        storeHistoryCloud: setStoreHistoryCloud,
        vesselNickname: setVesselNickname,
        shellyLocalPassword: setShellyLocalPassword,
        webhookUrl: setWebhookUrl,
        webhookUser: setWebhookUser,
        webhookKey: setWebhookKey,
        localServerEnabled: setLocalServerEnabled,
        localServerBackground: setLocalServerBackground,
        unitSystem: setUnitSystem,
        timeZone: setTimeZone,
        normalRunHours: setNormalRunHours,
        normalRunMinutes: setNormalRunMinutes,
        normalRunDaily: setNormalRunDaily,
        normalRunVolume: setNormalRunVolume,
        autoRestartNormal: setAutoRestartNormal,
        isCloudPollingActive: setIsCloudPollingActive,
        isLocalPollingActive: setIsLocalPollingActive,
        cloudUsername: setCloudUsername,
        cloudApiKey: setCloudApiKey,
        gatewayIp: setGatewayIp,
        gatewayId: setGatewayId,
        primaryDeviceId: setPrimaryDeviceId,
        secondaryDeviceId: setSecondaryDeviceId,
        shellyServer: setShellyServer,
        shellyAuthKey: setShellyAuthKey,
        highPowerIds: setHighPowerIds,
        lowPowerIds: setLowPowerIds,
        floodSensorIds: setFloodSensorIds,
        notificationsEnabled: setNotificationsEnabled,
        notifyAutoGuard: setNotifyAutoGuard,
        alertOffline: setAlertOffline,
        notifyLowBattery: setNotifyLowBattery,
        notifyWatering: setNotifyWatering,
        notifyFlood: setNotifyFlood,
        notifyHouseBatt: setNotifyHouseBatt,
        notifyEngineBatt: setNotifyEngineBatt,
        notifyShorePower: setNotifyShorePower,
        alarmSound: setAlarmSound,
        alarmVolume: setAlarmVolume,
        alarmRepeatInterval: setAlarmRepeatInterval,
        maxDuration: setMaxDuration,
        autoGuardEnabled: setAutoGuardEnabled,
        battType: setBattType,
        battSystemV: setBattSystemV,
        battLowVoltage: setBattLowVoltage,
        battCritVoltage: setBattCritVoltage,
        battNormalVoltage: setBattNormalVoltage,
        battOverVoltage: setBattOverVoltage,
        battChargeVoltage: setBattChargeVoltage,
        shoreCritLowV: setShoreCritLowV,
        shoreLowV: setShoreLowV,
        shoreNormalV: setShoreNormalV,
        shoreHighV: setShoreHighV,
        shoreCritHighV: setShoreCritHighV,
      });
      // lt_vehicle_type is managed outside the synced-settings map — re-read it on switch/cloud-sync.
      setVehicleType((localStorage.getItem('lt_vehicle_type') as '' | 'boat' | 'rv') || '');
      setDevices(getDevices());

      const currentVid = getActiveVehicleId();
      setActiveVid(currentVid);
      setVehiclesMap(getVehiclesMap());
      if (selectedVid === activeVid) {
        setSelectedVid(currentVid); // Auto-update dropdown if it was on the active vehicle
      }
    };

    const handleConnectionStateChange = (e: any) => {
      if (e.detail) {
        setConnectionStatus(e.detail.status);
      }
    };

    window.addEventListener('settings_updated', handleSettingsUpdate);
    window.addEventListener('connection_state_change', handleConnectionStateChange);
    return () => {
      window.removeEventListener('settings_updated', handleSettingsUpdate);
      window.removeEventListener('connection_state_change', handleConnectionStateChange);
    };
  }, []);

  // Sync to LocalStorage (throttled/batched by React's effect). The key list + serialization live
  // in utils/settingsStorage (writeSettings); this effect owns only the re-entry guard + the
  // settings_updated dispatch.
  useEffect(() => {
    writeSettings({
      syncSettingsCloud, storeHistoryCloud, vesselNickname, shellyLocalPassword,
      webhookUrl, webhookUser, webhookKey, localServerEnabled, localServerBackground,
      unitSystem, timeZone, normalRunHours, normalRunMinutes, normalRunDaily, normalRunVolume, autoRestartNormal,
      isCloudPollingActive, isLocalPollingActive, cloudUsername, cloudApiKey,
      gatewayIp, gatewayId, primaryDeviceId, secondaryDeviceId,
      shellyServer, shellyAuthKey, highPowerIds, lowPowerIds, floodSensorIds,
      notificationsEnabled, notifyAutoGuard, alertOffline, notifyLowBattery, notifyWatering,
      notifyFlood, notifyHouseBatt, notifyEngineBatt, notifyShorePower,
      alarmSound, alarmVolume, alarmRepeatInterval,
      maxDuration, autoGuardEnabled,
      battType, battSystemV,
      battLowVoltage, battCritVoltage, battNormalVoltage, battOverVoltage, battChargeVoltage,
      shoreCritLowV, shoreLowV, shoreNormalV, shoreHighV, shoreCritHighV,
    });

    syncDispatchRef.current = true;
    window.dispatchEvent(new Event('settings_updated'));
    syncDispatchRef.current = false;
  }, [
    syncSettingsCloud, storeHistoryCloud, vesselNickname, shellyLocalPassword, webhookUrl, webhookUser, webhookKey, localServerEnabled, localServerBackground, unitSystem, timeZone,
    normalRunHours, normalRunMinutes, normalRunDaily, normalRunVolume, autoRestartNormal,
    isCloudPollingActive, isLocalPollingActive, cloudUsername, cloudApiKey,
    gatewayIp, gatewayId, primaryDeviceId, secondaryDeviceId,
    shellyServer, shellyAuthKey, highPowerIds, lowPowerIds, floodSensorIds,
    notificationsEnabled, notifyAutoGuard, alertOffline,
    notifyLowBattery, notifyWatering, notifyFlood, notifyHouseBatt, notifyEngineBatt, notifyShorePower,
    alarmSound, alarmVolume, alarmRepeatInterval,
    maxDuration, autoGuardEnabled,
    battType, battSystemV,
    battLowVoltage, battCritVoltage, battNormalVoltage, battOverVoltage, battChargeVoltage,
    shoreCritLowV, shoreLowV, shoreNormalV, shoreHighV, shoreCritHighV
  ]);

  const handleManualSync = async () => {
    setIsManualSyncing(true);
    setManualSyncMsg(null);
    try {
      const vid = getActiveVehicleId();
      const timeoutPromise = new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Sync timed out')), 8000));
      await Promise.race([
        updateVehicleConfig(vid, getLocalVehicleConfig()),
        timeoutPromise
      ]);
      setManualSyncMsg({ text: 'Settings successfully synced to cloud!', type: 'success' });
      setTimeout(() => setManualSyncMsg(null), 5000);
    } catch (e: any) {
      setManualSyncMsg({ text: e.message || 'Failed to sync to cloud', type: 'error' });
    } finally {
      setIsManualSyncing(false);
    }
  };


  const handleExpandDevice = (deviceId: string) => {
    if (expandedDeviceId === deviceId) {
      setExpandedDeviceId(null);
      return;
    }
    const device = devices.find(d => d.id === deviceId);
    if (!device) return;
    const ltId = device.linktapDeviceId || device.id;
    setExpandedDeviceId(deviceId);
    setDevNormalHrs(Number(localStorage.getItem(`lt_norm_hrs_${ltId}`) || '24'));
    setDevNormalMins(Number(localStorage.getItem(`lt_norm_mins_${ltId}`) || '0'));
    setDevNormalDaily(localStorage.getItem(`lt_norm_daily_${ltId}`) === 'true');
    setDevNormalVol(Number(localStorage.getItem(`lt_norm_vol_${ltId}`) || '300'));
    setDevAutoRestart(localStorage.getItem(`lt_auto_restart_${ltId}`) === 'true');
    setFwMsg(''); setFwBusy(false);
  };

  // --- Firmware (Shelly devices) ---
  const handleCheckFirmware = async (device: DeviceConfig) => {
    const host = deviceLocalHost(device);
    if (!host) { setFwMsg('No local address for this device.'); return; }
    setFwBusy(true); setFwMsg('Checking…');
    try {
      const { shellyCheckFirmware, shellyRpc } = await import('../utils/shellyRpc');
      const { updateDevice } = await import('../utils/VehicleManager');
      const pw = localStorage.getItem('sh_local_password') || undefined;
      const fw = await shellyCheckFirmware((m, p) => shellyRpc(host, m, p, pw));
      updateDevice(device.id, { fwVersion: fw.version, fwUpdateVersion: fw.updateVersion || undefined });
      setDevices(getDevices());
      setFwMsg(fw.updateVersion ? `Update available: v${fw.updateVersion}` : 'Up to date.');
    } catch {
      setFwMsg(`Couldn't reach the device${device.batteryPowered ? ' — wake it (press its button) and retry' : ''}.`);
    } finally { setFwBusy(false); }
  };

  const handleUpdateFirmware = async (device: DeviceConfig) => {
    const host = deviceLocalHost(device);
    if (!host) return;
    setFwBusy(true); setFwMsg('Updating… the device downloads + reboots (~1–2 min). Keep it powered.');
    try {
      const { shellyApplyUpdate, shellyRpc } = await import('../utils/shellyRpc');
      const pw = localStorage.getItem('sh_local_password') || undefined;
      await shellyApplyUpdate((m, p) => shellyRpc(host, m, p, pw));
      setFwMsg('Update started — re-check in a couple minutes once it reboots.');
    } catch { setFwMsg('Failed to start the update.'); }
    finally { setFwBusy(false); }
  };

  const saveDeviceNormalRun = (key: string, value: string | number | boolean) => {
    const device = devices.find(d => d.id === expandedDeviceId);
    if (!device) return;
    const ltId = device.linktapDeviceId || device.id;
    localStorage.setItem(`${key}_${ltId}`, value.toString());
    window.dispatchEvent(new Event('settings_updated'));
  };

  // Switching vehicles while the on-device local server is running would leave it serving the wrong
  // vehicle, so we confirm first and stop it on the way out (it's device-global, off by default).
  const [pendingSwitchVid, setPendingSwitchVid] = useState<string | null>(null);

  const doSwitchVehicle = (vid: string) => {
    switchVehicle(vid);
    // State will naturally update via the settings_updated event listener
  };

  const handleSwitchVehicle = (vid: string) => {
    if (localStorage.getItem('lt_local_server') === 'true') {
      setPendingSwitchVid(vid); // ask before stopping the running local server
      return;
    }
    doSwitchVehicle(vid);
  };

  const confirmSwitchAndStopLocalServer = () => {
    const vid = pendingSwitchVid;
    // Stop the local server before switching: persist OFF + notify useSensorBridge to tear it down.
    localStorage.setItem('lt_local_server', 'false');
    setLocalServerEnabled(false);
    window.dispatchEvent(new Event('settings_updated'));
    setPendingSwitchVid(null);
    if (vid) doSwitchVehicle(vid);
  };

  const handleAddNewVehicle = () => {
    setNewVehicleNameInput('');
    setNewVehicleType('');
    setShowNewVehicleModal(true);
  };

  const confirmAddNewVehicle = () => {
    const newVid = addNewVehicle(newVehicleNameInput || 'New Vehicle', newVehicleType);
    switchVehicle(newVid); // loads the new vehicle's config (incl. type) into root → settings_updated refreshes UI
    setShowNewVehicleModal(false);
  };

  // Per-device action feedback (test connection / secure)
  const [devicePanelMsg, setDevicePanelMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [devicePanelBusy, setDevicePanelBusy] = useState(false);

  // Per-device voltage-offset calibration. The offset is written ONTO the device via
  // Voltmeter.SetConfig (xvoltage = "x + offset"), so the local poll and the Shelly cloud both report
  // the corrected value — single source of truth, no separate sync needed.
  const [offsetDraft, setOffsetDraft] = useState<Record<string, string>>({});
  const [voltReadMsg, setVoltReadMsg] = useState<Record<string, string>>({});

  // Read the device's current raw + calibrated voltage (helper for picking an offset).
  const readVoltNow = async (device: DeviceConfig) => {
    const host = deviceLocalHost(device);
    if (!host) return;
    setDevicePanelBusy(true);
    try {
      const { shellyRpc } = await import('../utils/shellyRpc');
      const st = await shellyRpc(host, 'Shelly.GetStatus', {}, localStorage.getItem('sh_local_password') || undefined);
      const id = findVoltmeterId(st);
      const vm = id != null ? st[`voltmeter:${id}`] : null;
      setVoltReadMsg((prev) => ({
        ...prev,
        [device.id]: vm
          ? `raw ${Number(vm.voltage).toFixed(2)} V${vm.xvoltage != null ? ` → ${Number(vm.xvoltage).toFixed(2)} V` : ''}`
          : 'no voltmeter — enable it first',
      }));
    } catch (e: any) {
      setVoltReadMsg((prev) => ({ ...prev, [device.id]: `✗ ${e?.message || 'unreachable'}` }));
    } finally { setDevicePanelBusy(false); }
  };

  // Write the offset to the device. offset 0 clears the transform (xvoltage off → raw voltage shown).
  const applyVoltOffset = async (device: DeviceConfig, explicitOff?: number) => {
    const host = deviceLocalHost(device);
    if (!host) { setDevicePanelMsg({ id: device.id, text: '✗ No local address for this device.', ok: false }); return; }
    const off = explicitOff !== undefined ? explicitOff : parseFloat(offsetDraft[device.id] ?? String(device.voltCalOffset ?? '0'));
    if (Number.isNaN(off)) { setDevicePanelMsg({ id: device.id, text: '✗ Enter a numeric offset (e.g. 0.32 or -0.15).', ok: false }); return; }
    setDevicePanelBusy(true); setDevicePanelMsg(null);
    try {
      const { shellyRpc } = await import('../utils/shellyRpc');
      const pw = localStorage.getItem('sh_local_password') || undefined;
      const id = findVoltmeterId(await shellyRpc(host, 'Shelly.GetStatus', {}, pw));
      if (id == null) { setDevicePanelMsg({ id: device.id, text: '✗ No voltmeter component — tap “Enable voltmeter” first.', ok: false }); return; }
      const xvoltage = off === 0 ? { expr: null, unit: null } : { expr: `x + (${off})`, unit: 'V' };
      await shellyRpc(host, 'Voltmeter.SetConfig', { id, config: { xvoltage } }, pw);
      updateDevice(device.id, { voltCalOffset: off || undefined });
      setDevices(getDevices());
      setDevicePanelMsg({ id: device.id, text: off === 0
        ? '✓ Offset cleared on the device — showing raw reading.'
        : `✓ Offset ${off >= 0 ? '+' : ''}${off} V written to the device (local + cloud now corrected).`, ok: true });
    } catch (e: any) {
      setDevicePanelMsg({ id: device.id, text: `✗ ${e?.message || 'failed'}${device.batteryPowered ? ' — wake the device and retry' : ''}`, ok: false });
    } finally { setDevicePanelBusy(false); }
  };

  // Device removal (with optional factory reset) — confirmed via dialog
  const [deviceToRemove, setDeviceToRemove] = useState<DeviceConfig | null>(null);
  const [factoryResetOnRemove, setFactoryResetOnRemove] = useState(false);
  const [removingDevice, setRemovingDevice] = useState(false);

  const confirmRemoveDevice = async () => {
    const device = deviceToRemove;
    if (!device) return;
    setRemovingDevice(true);
    try {
      if (factoryResetOnRemove && device.type === 'shelly_sensor' && device.localIp) {
        // Best-effort factory reset signal to the device on the local network.
        try { await nativeFetch(`http://${device.localIp}/rpc/Shelly.FactoryReset`); } catch { /* unreachable / auth — proceed with removal anyway */ }
      }
      const m = await import('../utils/VehicleManager');
      m.removeDevice(device.id);
      setDevices(m.getDevices());
      if (expandedDeviceId === device.id) setExpandedDeviceId(null);
    } finally {
      setRemovingDevice(false);
      setDeviceToRemove(null);
      setFactoryResetOnRemove(false);
    }
  };

  // Begin editing the Shelly local password (field becomes editable; button → "Save").
  const startEditShellyPw = () => { setShellyPwDraft(shellyLocalPassword); setPwChangeMsg(null); setIsEditingShellyPw(true); };

  // "Save" pressed: if unchanged just exit; if changed, open the confirm dialog before touching devices.
  const requestSaveShellyPw = () => {
    if (shellyPwDraft === shellyLocalPassword) { setIsEditingShellyPw(false); return; }
    setShowPwChangeModal(true);
  };

  // Confirmed: push the new password to every reachable Shelly device on this vehicle, then persist it.
  const confirmChangeShellyPw = async () => {
    const newPw = shellyPwDraft;
    const oldPw = shellyLocalPassword;
    setPwChangeBusy(true); setPwChangeMsg(null);
    try {
      const { shellyChangePassword } = await import('../utils/shellyRpc');
      const targets = getDevices().filter(d => d.type === 'shelly_sensor' && (d.localIp || d.mdnsHost) && d.shellyDeviceId);
      let ok = 0; const failed: string[] = [];
      for (const d of targets) {
        const host = d.localIp || d.mdnsHost!;
        try {
          await shellyChangePassword(host, d.shellyDeviceId!, newPw, oldPw || undefined);
          ok++;
        } catch (e: any) {
          failed.push(d.name || d.shellyDeviceId || host);
        }
      }
      // Persist the new password regardless (so the app authenticates with it going forward); the
      // device list reflects which succeeded. Battery/sleeping sensors will fail until they next wake.
      setShellyLocalPassword(newPw);
      setIsEditingShellyPw(false);
      setShowPwChangeModal(false);
      if (failed.length === 0) {
        setPwChangeMsg({ ok: true, text: targets.length ? `✓ Password updated on ${ok} device${ok === 1 ? '' : 's'}.` : '✓ Password saved (no reachable Shelly devices to update).' });
      } else {
        setPwChangeMsg({ ok: false, text: `Saved, but ${failed.length} device(s) did NOT update: ${failed.join(', ')}. Sleeping sensors update on next wake; otherwise re-secure them from the device panel (a factory reset + re-pair may be needed).` });
      }
    } finally {
      setPwChangeBusy(false);
    }
  };

  const handleDeleteVehicle = () => {
    const idToDelete = activeVid;
    // Sole owner → HARD-delete the cloud doc so it doesn't linger orphaned in the admin portal.
    // Shared → just remove self (leave). Hard-delete needs the `delete` rule deployed; fall back to a
    // leave if it's rejected so we at least detach this user.
    const cv = (cloudVehicles || []).find((v: any) => v.id === idToDelete);
    const others = ((cv?.allowedUsers as string[]) || []).filter((u) => u !== user?.uid);
    deleteVehicle(idToDelete); // local removal + tombstone + switch to fallback
    if (cv && others.length === 0) {
      hardDeleteVehicleConfig(idToDelete).catch(() => deleteVehicleConfig(idToDelete).catch(() => {}));
    } else {
      deleteVehicleConfig(idToDelete).catch(() => {});
    }
    setShowDeleteModal(false);
    setDeleteConfirmChecked(false);
  };

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto', color: '#fff', paddingBottom: '100px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <h2 style={{ fontSize: '2rem', color: 'var(--accent-cyan)', margin: 0 }}>Settings</h2>
      
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '16px', overflowX: 'auto' }}>
        <button onClick={() => setActiveTab('general')} className={activeTab === 'general' ? 'btn-primary' : 'btn-secondary'} style={{ padding: '8px 16px', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>General</button>
        <button onClick={() => setActiveTab('devices')} className={activeTab === 'devices' ? 'btn-primary' : 'btn-secondary'} style={{ padding: '8px 16px', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>Devices</button>
        <button onClick={() => setActiveTab('friends')} className={activeTab === 'friends' ? 'btn-primary' : 'btn-secondary'} style={{ padding: '8px 16px', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>Sharing</button>
        <button onClick={() => setActiveTab('updates')} className={activeTab === 'updates' ? 'btn-primary' : 'btn-secondary'} style={{ padding: '8px 16px', fontSize: '0.9rem', whiteSpace: 'nowrap', position: 'relative' }}>
          Updates
          {latestVersion && latestVersion !== APP_VERSION && <span style={{ position: 'absolute', top: '4px', right: '4px', width: '8px', height: '8px', background: '#ef4444', borderRadius: '50%' }}></span>}
        </button>
      </div>

      {activeTab === 'general' && (
        <>
          {/* Vehicles Sub-section (App & System Config) */}
          <VehiclesPanel
            selectedVid={selectedVid} setSelectedVid={setSelectedVid}
            vehiclesMap={vehiclesMap} activeVid={activeVid}
            onSwitchVehicle={handleSwitchVehicle} onAddNewVehicle={handleAddNewVehicle}
            isEditingName={isEditingName} setIsEditingName={setIsEditingName}
            vesselNickname={vesselNickname} setVesselNickname={setVesselNickname}
            vehicleType={vehicleType} onChangeVehicleType={changeVehicleType}
            isEditingType={isEditingType} setIsEditingType={setIsEditingType}
            showShellyPw={showShellyPw} setShowShellyPw={setShowShellyPw}
            isEditingShellyPw={isEditingShellyPw} setIsEditingShellyPw={setIsEditingShellyPw}
            shellyPwDraft={shellyPwDraft} setShellyPwDraft={setShellyPwDraft}
            shellyLocalPassword={shellyLocalPassword}
            pwChangeMsg={pwChangeMsg} setPwChangeMsg={setPwChangeMsg}
            onStartEditShellyPw={startEditShellyPw} onRequestSaveShellyPw={requestSaveShellyPw}
            showAdvanced={showAdvanced} setShowAdvanced={setShowAdvanced}
            webhookUrl={webhookUrl} setWebhookUrl={setWebhookUrl}
            webhookUser={webhookUser} setWebhookUser={setWebhookUser}
            webhookKey={webhookKey} setWebhookKey={setWebhookKey}
            showWebhookKey={showWebhookKey} setShowWebhookKey={setShowWebhookKey}
            onManualSync={handleManualSync} user={user}
            isManualSyncing={isManualSyncing} manualSyncMsg={manualSyncMsg}
          />

          {/* Account Information (moved below Vehicles) */}
          <AccountPanel
            user={user} localMode={isLocalMode(localStorage)} showLogin={showLogin} setShowLogin={setShowLogin}
            syncSettingsCloud={syncSettingsCloud} setSyncSettingsCloud={setSyncSettingsCloud}
            canCloudHistory={canCloudHistory}
            storeHistoryCloud={storeHistoryCloud} setStoreHistoryCloud={setStoreHistoryCloud}
            vehiclesMap={vehiclesMap} userConfig={userConfig} updateUserConfig={updateUserConfig}
            defaultVidSaving={defaultVidSaving} setDefaultVidSaving={setDefaultVidSaving}
          />

          {/* Local Server (moved above Notifications, below Account Info) */}
          <LocalServerPanel
            enabled={localServerEnabled}
            onEnabledChange={setLocalServerEnabled}
            background={localServerBackground}
            onBackgroundChange={setLocalServerBackground}
          />

          {/* Device Preferences — local to this device, not synced to cloud */}
          <DevicePreferencesPanel
            unitSystem={unitSystem} setUnitSystem={setUnitSystem}
            timeZone={timeZone} setTimeZone={setTimeZone}
          >
            <NotificationsPanel
              notificationsEnabled={notificationsEnabled} onNotificationsEnabledChange={setNotificationsEnabled}
              notifyAutoGuard={notifyAutoGuard} onNotifyAutoGuardChange={setNotifyAutoGuard}
              alertOffline={alertOffline} onAlertOfflineChange={setAlertOffline}
              notifyWatering={notifyWatering} onNotifyWateringChange={setNotifyWatering}
              notifyFlood={notifyFlood} onNotifyFloodChange={setNotifyFlood}
              notifyLowBattery={notifyLowBattery} onNotifyLowBatteryChange={setNotifyLowBattery}
              notifyHouseBatt={notifyHouseBatt} onNotifyHouseBattChange={setNotifyHouseBatt}
              notifyEngineBatt={notifyEngineBatt} onNotifyEngineBattChange={setNotifyEngineBatt}
              notifyShorePower={notifyShorePower} onNotifyShorePowerChange={setNotifyShorePower}
              alarmSound={alarmSound} onAlarmSoundChange={setAlarmSound}
              alarmRepeatInterval={alarmRepeatInterval} onAlarmRepeatIntervalChange={setAlarmRepeatInterval}
              alarmVolume={alarmVolume} onAlarmVolumeChange={setAlarmVolume}
            />
          </DevicePreferencesPanel>

        </>
      )}

      {activeTab === 'general' && (
        <>
        {/* Delete Vehicle Section */}
        <div className="glass-card" style={{ border: '1px solid rgba(239, 68, 68, 0.2)' }}>
          <h3 style={{ marginTop: 0, color: '#ef4444', borderBottom: '1px solid rgba(239, 68, 68, 0.2)', paddingBottom: '8px', marginBottom: '16px' }}>Danger Zone</h3>
          <button 
            className="btn-secondary" 
            onClick={() => setShowDeleteModal(true)}
            style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)', width: '100%' }}
            disabled={Object.keys(vehiclesMap).length <= 1}
          >
            Delete this Vehicle
          </button>
          {Object.keys(vehiclesMap).length <= 1 && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '8px' }}>
              You cannot delete your only vehicle. To remove everything, delete your account below.
            </div>
          )}
          {auth.currentUser?.uid && (
            <div style={{ borderTop: '1px solid rgba(239, 68, 68, 0.2)', paddingTop: '14px', marginTop: '16px' }}>
              <div style={{ fontSize: '0.85rem', color: '#fca5a5', marginBottom: '8px' }}>
                Permanently delete my account{Object.keys(vehiclesMap).length <= 1 ? ' and my last vehicle' : ' and all my vehicles'}.
              </div>
              <DeleteAccountButton
                uid={auth.currentUser.uid}
                intro="This permanently deletes your account, the vehicles you solely own (including this one), and removes you from any shared vehicles."
              />
            </div>
          )}
        </div>
      </>
      )}

      {activeTab === 'devices' && (
        <>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', overflowX: 'auto' }}>
            <button className={devicesTab === 'add' ? 'btn-primary' : 'btn-secondary'} onClick={() => setDevicesTab('add')} style={{ padding: '6px 12px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>+ Add a device</button>
            <button className={devicesTab === 'config' ? 'btn-primary' : 'btn-secondary'} onClick={() => setDevicesTab('config')} style={{ padding: '6px 12px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>Configuration</button>
            <button className={devicesTab === 'advanced' ? 'btn-primary' : 'btn-secondary'} onClick={() => setDevicesTab('advanced')} style={{ padding: '6px 12px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>Advanced Options</button>
            <button className={devicesTab === 'auth' ? 'btn-primary' : 'btn-secondary'} onClick={() => setDevicesTab('auth')} style={{ padding: '6px 12px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>LinkTap Auth</button>
          </div>

          {devicesTab === 'add' && (
            <AddDevicePanel
              deviceCount={devices.length}
              maxDevices={entitlements.maxDevices}
              onAddLinkTap={() => { if (devices.length < entitlements.maxDevices) setIsProvisionLinkTapModalOpen(true); }}
              onAddShelly={() => { if (devices.length < entitlements.maxDevices) setIsProvisionModalOpen(true); }}
            />
          )}

          {devicesTab === 'auth' && (
            <LinkTapAuthPanel
              connectionStatus={connectionStatus}
              isCloudPollingActive={isCloudPollingActive} setIsCloudPollingActive={setIsCloudPollingActive}
              isLocalPollingActive={isLocalPollingActive} setIsLocalPollingActive={setIsLocalPollingActive}
              cloudUsername={cloudUsername} setCloudUsername={setCloudUsername}
              cloudApiKey={cloudApiKey} setCloudApiKey={setCloudApiKey}
              showCloudApiKey={showCloudApiKey} setShowCloudApiKey={setShowCloudApiKey}
              handleRetrieveFromCloud={handleRetrieveFromCloud}
              isDiscovering={isDiscovering} discoveryMsg={discoveryMsg}
              gatewayIp={gatewayIp} setGatewayIp={setGatewayIp}
              handleScanGateway={handleScanGateway} isScanningGateway={isScanningGateway}
              scanMsg={scanMsg} setScanMsg={setScanMsg} scanResults={scanResults} setScanResults={setScanResults}
              gatewayId={gatewayId} setGatewayId={setGatewayId}
              cloudGateways={cloudGateways} gatewayIdManual={gatewayIdManual} setGatewayIdManual={setGatewayIdManual}
              primaryDeviceId={primaryDeviceId} setPrimaryDeviceId={setPrimaryDeviceId}
              secondaryDeviceId={secondaryDeviceId} setSecondaryDeviceId={setSecondaryDeviceId}
              cloudTaplinkers={cloudTaplinkers}
              device1Manual={device1Manual} setDevice1Manual={setDevice1Manual}
              device2Manual={device2Manual} setDevice2Manual={setDevice2Manual}
            />
          )}

          {devicesTab === 'config' && (
            <DeviceConfigPanel
              devices={devices} setDevices={setDevices}
              expandedDeviceId={expandedDeviceId} handleExpandDevice={handleExpandDevice}
              setDeviceToRemove={setDeviceToRemove} setFactoryResetOnRemove={setFactoryResetOnRemove}
              fwBusy={fwBusy} fwMsg={fwMsg}
              handleCheckFirmware={handleCheckFirmware} handleUpdateFirmware={handleUpdateFirmware}
              devNormalHrs={devNormalHrs} setDevNormalHrs={setDevNormalHrs}
              devNormalMins={devNormalMins} setDevNormalMins={setDevNormalMins}
              devNormalDaily={devNormalDaily} setDevNormalDaily={setDevNormalDaily}
              devNormalVol={devNormalVol} setDevNormalVol={setDevNormalVol}
              devAutoRestart={devAutoRestart} setDevAutoRestart={setDevAutoRestart}
              saveDeviceNormalRun={saveDeviceNormalRun} volUnit={volUnit}
              devicePanelBusy={devicePanelBusy} setDevicePanelBusy={setDevicePanelBusy}
              devicePanelMsg={devicePanelMsg} setDevicePanelMsg={setDevicePanelMsg}
              deviceLocalHost={deviceLocalHost}
              readVoltNow={readVoltNow} voltReadMsg={voltReadMsg}
              offsetDraft={offsetDraft} setOffsetDraft={setOffsetDraft} applyVoltOffset={applyVoltOffset}
            />
          )}

          {devicesTab === 'advanced' && (
            <AdvancedDeviceSettingsPanel
              battType={battType} battSystemV={battSystemV}
              onApplyBatteryPreset={applyBatteryPreset} onBattCustom={() => setBattType('custom')}
              battCritVoltage={battCritVoltage} onBattCritChange={setBattCritVoltage}
              battLowVoltage={battLowVoltage} onBattLowChange={setBattLowVoltage}
              battNormalVoltage={battNormalVoltage} onBattNormalChange={setBattNormalVoltage}
              battChargeVoltage={battChargeVoltage} onBattChargeChange={setBattChargeVoltage}
              battOverVoltage={battOverVoltage} onBattOverChange={setBattOverVoltage}
              shoreCritLowV={shoreCritLowV} onShoreCritLowChange={setShoreCritLowV}
              shoreLowV={shoreLowV} onShoreLowChange={setShoreLowV}
              shoreNormalV={shoreNormalV} onShoreNormalChange={setShoreNormalV}
              shoreHighV={shoreHighV} onShoreHighChange={setShoreHighV}
              shoreCritHighV={shoreCritHighV} onShoreCritHighChange={setShoreCritHighV}
            />
          )}
        </>
      )}

      {activeTab === 'friends' && (
        <FriendsPanel
          user={user}
          showLogin={showLogin} onShowLogin={setShowLogin}
          shareMsg={shareMsg} onShareMsg={setShareMsg}
          pendingInvites={pendingInvites} friendsBusy={friendsBusy}
          onAcceptInvite={handleAcceptInvite} onDeclineInvite={handleDeclineInvite}
          activeVehicleName={activeVehicleName} isActiveAdmin={isActiveAdmin}
          hasActiveCloudVehicle={!!activeCloudVehicle}
          shareEmail={shareEmail} onShareEmailChange={setShareEmail}
          shareRole={shareRole} onShareRoleChange={setShareRole}
          onCreateInvite={handleCreateInvite} lastInvite={lastInvite}
          activeMembers={activeMembers} activeVid={activeVid} onRemoveMember={handleRemoveMember}
          activeOwner={activeOwner} isActiveOwner={isActiveOwner} onTransferOwnership={handleTransferOwnership}
          sentInvitesForActive={sentInvites[activeVid] || []} onCancelInvite={handleCancelInvite}
          sharedWithMe={sharedWithMe} onLeaveVehicle={handleLeaveVehicle}
        />
      )}

      {activeTab === 'updates' && (
        <SoftwareUpdatesPanel appVersion={APP_VERSION} latestVersion={latestVersion} tauriUpdate={appUpdater} />
      )}
      
      <SettingsModals
        deviceToRemove={deviceToRemove} factoryResetOnRemove={factoryResetOnRemove}
        setFactoryResetOnRemove={setFactoryResetOnRemove} removingDevice={removingDevice}
        onCancelRemoveDevice={() => { setDeviceToRemove(null); setFactoryResetOnRemove(false); }}
        onConfirmRemoveDevice={confirmRemoveDevice}
        showNewVehicleModal={showNewVehicleModal} newVehicleNameInput={newVehicleNameInput}
        setNewVehicleNameInput={setNewVehicleNameInput}
        newVehicleType={newVehicleType} setNewVehicleType={setNewVehicleType}
        onCancelNewVehicle={() => setShowNewVehicleModal(false)} onConfirmNewVehicle={confirmAddNewVehicle}
        pendingSwitchVid={pendingSwitchVid}
        onCancelSwitch={() => setPendingSwitchVid(null)} onConfirmSwitch={confirmSwitchAndStopLocalServer}
        showPwChangeModal={showPwChangeModal} pwChangeBusy={pwChangeBusy}
        onCancelPwChange={() => setShowPwChangeModal(false)} onConfirmPwChange={confirmChangeShellyPw}
        showDeleteModal={showDeleteModal} vesselNickname={vesselNickname}
        deleteConfirmChecked={deleteConfirmChecked} setDeleteConfirmChecked={setDeleteConfirmChecked}
        onCancelDelete={() => setShowDeleteModal(false)} onConfirmDelete={handleDeleteVehicle}
      />

      {isProvisionModalOpen && <ProvisionShellyModal onClose={() => { setIsProvisionModalOpen(false); setDevices(getDevices()); }} />}
      {isProvisionLinkTapModalOpen && <ProvisionLinkTapModal onClose={() => { setIsProvisionLinkTapModalOpen(false); setDevices(getDevices()); }} />}
    </div>
  );
}
