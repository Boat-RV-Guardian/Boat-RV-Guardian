import { useState, useEffect, useRef } from 'react';
import { auth, signOut } from '../services/firebase';
import Login from './Login';

import { getActiveVehicleId, getVehiclesMap, switchVehicle, addNewVehicle, deleteVehicle, getDevices, updateDevice, type DeviceConfig } from '../utils/VehicleManager';
import { getLocalVehicleConfig } from '../utils/configSync';
import { nativeFetch } from '../utils/nativeFetch';
import { useCloudConfig } from '../hooks/useCloudConfig';
import { usePendingInvites } from '../hooks/usePendingInvites';
import {
  ROLE_OPTIONS, ROLE_LABELS, getMyRole, getMembers, createInvite, acceptInvite, declineInvite,
  cancelInvite, removeMember, leaveVehicle, listSentInvites, ensureOwnerAdmin,
  type VehicleRole, type Invite, type Member,
} from '../utils/sharing';
import ProvisionShellyModal from '../components/ProvisionShellyModal';
import ProvisionLinkTapModal from '../components/ProvisionLinkTapModal';
import PlanBadge from './settings/PlanBadge';

const APP_VERSION = '1.0.43';

// Battery voltage presets by chemistry, for 12 V and 24 V systems (24 V ≈ 2× the 12 V figures).
// Values are marine/RV norms: crit = near-empty alarm, low = recharge warning, normal = resting-full
// nominal, charge = "charging detected" threshold, over = over-voltage alarm. 'custom' applies no
// preset — the fields stay manually editable.
type BattThresholds = { crit: number; low: number; normal: number; charge: number; over: number };
const BATTERY_PRESETS: Record<string, { label: string; v: Record<'12' | '24', BattThresholds> }> = {
  flooded: {
    label: 'Flooded Lead-Acid',
    v: {
      '12': { crit: 11.8, low: 12.2, normal: 12.6, charge: 13.6, over: 15.0 },
      '24': { crit: 23.6, low: 24.4, normal: 25.2, charge: 27.2, over: 30.0 },
    },
  },
  agm: {
    label: 'AGM (Sealed)',
    v: {
      '12': { crit: 11.8, low: 12.0, normal: 12.8, charge: 13.6, over: 14.7 },
      '24': { crit: 23.6, low: 24.0, normal: 25.6, charge: 27.2, over: 29.4 },
    },
  },
  gel: {
    label: 'Gel',
    v: {
      '12': { crit: 11.8, low: 12.0, normal: 12.8, charge: 13.5, over: 14.2 },
      '24': { crit: 23.6, low: 24.0, normal: 25.6, charge: 27.0, over: 28.4 },
    },
  },
  lifepo4: {
    label: 'Lithium (LiFePO₄)',
    v: {
      '12': { crit: 12.0, low: 12.8, normal: 13.2, charge: 13.8, over: 14.6 },
      '24': { crit: 24.0, low: 25.6, normal: 26.4, charge: 27.6, over: 29.2 },
    },
  },
  custom: {
    label: 'Custom (manual)',
    v: {
      '12': { crit: 11.8, low: 12.2, normal: 12.6, charge: 13.6, over: 15.0 },
      '24': { crit: 23.6, low: 24.4, normal: 25.2, charge: 27.2, over: 30.0 },
    },
  },
};



export default function Settings({ user }: { user: any }) {
  const [showLogin, setShowLogin] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'accounts' | 'devices' | 'friends' | 'updates'>('general');
  const [devicesTab, setDevicesTab] = useState<'add' | 'config' | 'advanced' | 'auth'>('config');
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

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
  }, []);

  // Vehicle Management State
  const [activeVid, setActiveVid] = useState(() => getActiveVehicleId());
  const [vehiclesMap, setVehiclesMap] = useState(() => getVehiclesMap());
  const [selectedVid, setSelectedVid] = useState(() => getActiveVehicleId());

  // Vehicle Modals State
  const [showNewVehicleModal, setShowNewVehicleModal] = useState(false);
  const [newVehicleNameInput, setNewVehicleNameInput] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmChecked, setDeleteConfirmChecked] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);

  // Cross-device sync
  // Cloud-vehicle reconciliation lives in SyncModal (always mounted) so it works app-wide.
  // Settings only needs the cloud write helpers; its vehiclesMap refreshes via settings_updated.
  const { cloudVehicles, userConfig, updateVehicleConfig, updateUserConfig, deleteVehicleConfig } = useCloudConfig(null);
  const [defaultVidSaving, setDefaultVidSaving] = useState(false);

  // --- Friends / Sharing state ---
  const pendingInvites = usePendingInvites();
  const [shareEmail, setShareEmail] = useState('');
  const [shareRole, setShareRole] = useState<VehicleRole>('monitor');
  const [shareMsg, setShareMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [lastInvite, setLastInvite] = useState<Invite | null>(null);
  const [sentInvites, setSentInvites] = useState<Record<string, Invite[]>>({});
  const [friendsBusy, setFriendsBusy] = useState(false);

  // Vehicles I administer vs. ones shared with me (from the live cloud docs, which carry roles)
  const adminVehicles = (cloudVehicles || []).filter(cv => getMyRole(cv) === 'admin');
  const sharedWithMe = (cloudVehicles || []).filter(cv => { const r = getMyRole(cv); return r === 'control' || r === 'monitor'; });

  // Sharing is scoped to the ACTIVE vehicle only — you share whatever you're currently in.
  const activeCloudVehicle = (cloudVehicles || []).find(cv => cv.id === activeVid);
  const isActiveAdmin = activeCloudVehicle ? getMyRole(activeCloudVehicle) === 'admin' : false;
  const activeVehicleName = activeCloudVehicle?.lt_vessel_name || localStorage.getItem('lt_vessel_name') || 'this vehicle';
  // Members of the active vehicle. Legacy owners have no members map yet, so synthesize the
  // current admin (you) until ensureOwnerAdmin backfills the doc.
  const activeMembers: Member[] = (() => {
    const m = getMembers(activeCloudVehicle);
    if (user && isActiveAdmin && !m.some(x => x.uid === user.uid)) {
      return [{ uid: user.uid, role: 'admin', email: user.email || '(you)' }, ...m];
    }
    return m;
  })();

  // Load outstanding sent invites for each vehicle I administer
  const refreshSentInvites = async () => {
    const map: Record<string, Invite[]> = {};
    for (const cv of adminVehicles) {
      try { map[cv.id] = (await listSentInvites(cv.id)).filter(i => i.status === 'pending'); } catch { /* ignore */ }
    }
    setSentInvites(map);
  };
  useEffect(() => {
    if (activeTab === 'friends' && adminVehicles.length > 0) refreshSentInvites();
    // Backfill the owner's members entry on the active vehicle so People With Access lists them.
    if (activeTab === 'friends' && isActiveAdmin && activeVid) ensureOwnerAdmin(activeVid).catch(() => {});
  }, [activeTab, cloudVehicles.length]);

  const handleCreateInvite = async () => {
    setShareMsg(null);
    setLastInvite(null);
    if (!activeVid || !isActiveAdmin) { setShareMsg({ text: 'You must be an admin of the active vehicle to share it.', type: 'error' }); return; }
    setFriendsBusy(true);
    try {
      const name = activeCloudVehicle?.lt_vessel_name || localStorage.getItem('lt_vessel_name') || 'Vehicle';
      const invite = await createInvite(activeVid, name, shareEmail, shareRole);
      setLastInvite(invite);
      setShareEmail('');
      setShareMsg({ text: 'Invite created — share the message below with your friend.', type: 'success' });
      refreshSentInvites();
    } catch (e: any) {
      setShareMsg({ text: e.message || 'Failed to create invite', type: 'error' });
    } finally {
      setFriendsBusy(false);
    }
  };

  const handleAcceptInvite = async (invite: Invite) => {
    setFriendsBusy(true);
    try { await acceptInvite(invite); } catch (e: any) { setShareMsg({ text: e.message || 'Failed to accept', type: 'error' }); }
    finally { setFriendsBusy(false); }
  };
  const handleDeclineInvite = async (invite: Invite) => {
    setFriendsBusy(true);
    try { await declineInvite(invite.id); } catch { /* ignore */ } finally { setFriendsBusy(false); }
  };
  const handleRemoveMember = async (vid: string, member: Member) => {
    setFriendsBusy(true);
    try { await removeMember(vid, member.uid); } catch (e: any) { setShareMsg({ text: e.message || 'Failed to remove', type: 'error' }); }
    finally { setFriendsBusy(false); }
  };
  const handleCancelInvite = async (inviteId: string) => {
    setFriendsBusy(true);
    try { await cancelInvite(inviteId); refreshSentInvites(); } catch { /* ignore */ } finally { setFriendsBusy(false); }
  };
  const handleLeaveVehicle = async (vid: string) => {
    setFriendsBusy(true);
    try { await leaveVehicle(vid); } catch (e: any) { setShareMsg({ text: e.message || 'Failed to leave', type: 'error' }); }
    finally { setFriendsBusy(false); }
  };

  // Sync Toggles
  const [syncSettingsCloud, setSyncSettingsCloud] = useState(() => localStorage.getItem('lt_sync_cloud') !== 'false');
  const [storeHistoryCloud, setStoreHistoryCloud] = useState(() => localStorage.getItem('lt_store_history_cloud') === 'true');

  // App Settings State
  const [unitSystem, setUnitSystem] = useState<'metric' | 'imperial'>(() => localStorage.getItem('lt_unit') as 'metric' | 'imperial' || 'imperial');
  const volUnit = unitSystem === 'imperial' ? 'Gallons' : 'Liters';
  const [timeZone, setTimeZone] = useState(() => localStorage.getItem('lt_tz') || ((Intl as any).supportedValuesOf ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'));
  const [vesselNickname, setVesselNickname] = useState(() => localStorage.getItem('lt_vessel_name') || '');
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
  // Cloud-retrieved options for dropdowns (not persisted)
  const [cloudGateways, setCloudGateways] = useState<{id: string, name: string}[]>([]);
  const [cloudTaplinkers, setCloudTaplinkers] = useState<{id: string, name: string, gatewayId: string}[]>([]);
  const [isScanningGateway, setIsScanningGateway] = useState(false);
  const [scanMsg, setScanMsg] = useState<{text: string, type: 'success'|'error'} | null>(null);
  const [scanResults, setScanResults] = useState<string[]>([]);
  // Manual-entry mode for each dropdown (falls back to text input)
  const [gatewayIdManual, setGatewayIdManual] = useState(false);
  const [device1Manual, setDevice1Manual] = useState(false);
  const [device2Manual, setDevice2Manual] = useState(false);

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
    const preset = BATTERY_PRESETS[type]?.v[sysV as '12' | '24'];
    if (type !== 'custom' && preset) {
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
  const [maxFlowRate, setMaxFlowRate] = useState(() => Number(localStorage.getItem('lt_max_flow') || '15'));
  const [maxDuration, setMaxDuration] = useState(() => Number(localStorage.getItem('lt_max_dur') || '30'));
  const [autoGuardEnabled, setAutoGuardEnabled] = useState(() => localStorage.getItem('lt_auto_guard') !== 'false');

  // Guard to prevent Settings.tsx from re-processing its own dispatched settings_updated events.
  // window.dispatchEvent is synchronous, so setting true before dispatch and false after covers the window.
  const syncDispatchRef = useRef(false);

  // Connection Engine Cross-Communication
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'mock' | 'connecting'>('disconnected');
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryMsg, setDiscoveryMsg] = useState<{text: string, type: 'success' | 'error'} | null>(null);

  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const [manualSyncMsg, setManualSyncMsg] = useState<{text: string, type: 'success' | 'error'} | null>(null);

  useEffect(() => {
    const handleSettingsUpdate = () => {
      // Skip events we dispatched ourselves — prevents the sync effect from looping
      if (syncDispatchRef.current) return;

      // Re-hydrate local state from localStorage if a background update happened
      setSyncSettingsCloud(localStorage.getItem('lt_sync_cloud') !== 'false');
      setStoreHistoryCloud(localStorage.getItem('lt_store_history_cloud') === 'true');
      setUnitSystem(localStorage.getItem('lt_unit') as 'metric' | 'imperial' || 'imperial');
      setTimeZone(localStorage.getItem('lt_tz') || ((Intl as any).supportedValuesOf ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'));
      setShellyLocalPassword(localStorage.getItem('sh_local_password') || '');
      setWebhookUrl(localStorage.getItem('sh_webhook_url') || '');
      setWebhookUser(localStorage.getItem('sh_webhook_user') || '');
      setWebhookKey(localStorage.getItem('sh_webhook_key') || '');
      // Default OFF (=== 'true') to match the off-by-default change (Task 5); the main.tsx migration
      // sets it 'true' for existing installs.
      setLocalServerEnabled(localStorage.getItem('lt_local_server') === 'true');
      setLocalServerBackground(localStorage.getItem('lt_local_server_bg') === 'true');
      setVesselNickname(localStorage.getItem('lt_vessel_name') || '');
      setNormalRunHours(Number(localStorage.getItem('lt_nr_hrs') || '0'));
      setNormalRunMinutes(Number(localStorage.getItem('lt_nr_mins') || '0'));
      setNormalRunDaily(localStorage.getItem('lt_nr_daily') === 'true');
      setNormalRunVolume(Number(localStorage.getItem('lt_nr_vol') || '10'));
      setAutoRestartNormal(localStorage.getItem('lt_nr_auto') === 'true');

      setIsCloudPollingActive(localStorage.getItem('lt_is_cloud_polling') === 'true');
      setIsLocalPollingActive(localStorage.getItem('lt_is_local_polling') === 'true');
      setCloudUsername(localStorage.getItem('lt_cloud_user') || '');
      setCloudApiKey(localStorage.getItem('lt_cloud_key') || '');
      setGatewayIp(localStorage.getItem('lt_gateway_ip') || '');
      setGatewayId(localStorage.getItem('lt_gateway_id') || '');
      setPrimaryDeviceId(localStorage.getItem('lt_device_id') || '');
      setSecondaryDeviceId(localStorage.getItem('lt_device_id_2') || '');

      setShellyServer(localStorage.getItem('sh_server') || 'shelly-1-eu.shelly.cloud');
      setShellyAuthKey(localStorage.getItem('sh_auth_key') || '');
      setDevices(getDevices());
      try {
        setHighPowerIds(JSON.parse(localStorage.getItem('sh_high_power') || '["", "", "", ""]'));
        setLowPowerIds(JSON.parse(localStorage.getItem('sh_low_power') || '["", "", "", ""]'));
        setFloodSensorIds(JSON.parse(localStorage.getItem('sh_flood') || '["", "", "", ""]'));
      } catch (e) { console.error('Failed to parse shelly device IDs', e); }

      setNotificationsEnabled(localStorage.getItem('lt_notif_enabled') !== 'false');
      setNotifyAutoGuard(localStorage.getItem('lt_notif_ag') !== 'false');
      setAlertOffline(localStorage.getItem('lt_alert_offline') !== 'false');
      setNotifyLowBattery(localStorage.getItem('lt_notif_batt') !== 'false');
      setNotifyWatering(localStorage.getItem('lt_notif_water') === 'true');
      setAlarmSound((localStorage.getItem('lt_alarm_sound') as any) || 'siren');
      setAlarmVolume(Number(localStorage.getItem('lt_alarm_vol') || '1.0'));
      setAlarmRepeatInterval((localStorage.getItem('lt_alarm_repeat') as any) || '30');

      setMaxFlowRate(Number(localStorage.getItem('lt_max_flow') || '15'));
      setMaxDuration(Number(localStorage.getItem('lt_max_dur') || '30'));
      setAutoGuardEnabled(localStorage.getItem('lt_auto_guard') !== 'false');

      setBattType(localStorage.getItem('lt_batt_type') || 'flooded');
      setBattSystemV(localStorage.getItem('lt_batt_system_v') || '12');
      setBattLowVoltage(Number(localStorage.getItem('lt_batt_low_v') || '12.2'));
      setBattCritVoltage(Number(localStorage.getItem('lt_batt_crit_v') || '11.8'));
      setBattNormalVoltage(Number(localStorage.getItem('lt_batt_normal_v') || '12.6'));
      setBattOverVoltage(Number(localStorage.getItem('lt_batt_over_v') || '15.0'));
      setBattChargeVoltage(Number(localStorage.getItem('lt_batt_charge_v') || '13.6'));
      setShoreCritLowV(Number(localStorage.getItem('lt_shore_crit_low_v') || '104'));
      setShoreLowV(Number(localStorage.getItem('lt_shore_low_v') || '114'));
      setShoreNormalV(Number(localStorage.getItem('lt_shore_normal_v') || '120'));
      setShoreHighV(Number(localStorage.getItem('lt_shore_high_v') || '126'));
      setShoreCritHighV(Number(localStorage.getItem('lt_shore_crit_high_v') || '132'));

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

  // Sync to LocalStorage (throttled/batched by React's effect)
  useEffect(() => {
    localStorage.setItem('lt_sync_cloud', syncSettingsCloud.toString());
    localStorage.setItem('lt_store_history_cloud', storeHistoryCloud.toString());
    localStorage.setItem('lt_vessel_name', vesselNickname);
    localStorage.setItem('sh_local_password', shellyLocalPassword);
    localStorage.setItem('sh_webhook_url', webhookUrl.trim());
    localStorage.setItem('sh_webhook_user', webhookUser.trim());
    localStorage.setItem('sh_webhook_key', webhookKey.trim());
    localStorage.setItem('lt_local_server', localServerEnabled.toString());
    localStorage.setItem('lt_local_server_bg', localServerBackground.toString());
    localStorage.setItem('lt_unit', unitSystem);
    localStorage.setItem('lt_tz', timeZone);
    localStorage.setItem('lt_nr_hrs', normalRunHours.toString());
    localStorage.setItem('lt_nr_mins', normalRunMinutes.toString());
    localStorage.setItem('lt_nr_daily', normalRunDaily.toString());
    localStorage.setItem('lt_nr_vol', normalRunVolume.toString());
    localStorage.setItem('lt_nr_auto', autoRestartNormal.toString());

    localStorage.setItem('lt_is_cloud_polling', isCloudPollingActive.toString());
    localStorage.setItem('lt_is_local_polling', isLocalPollingActive.toString());
    localStorage.setItem('lt_cloud_user', cloudUsername);
    localStorage.setItem('lt_cloud_key', cloudApiKey);
    localStorage.setItem('lt_gateway_ip', gatewayIp);
    localStorage.setItem('lt_gateway_id', gatewayId);
    localStorage.setItem('lt_device_id', primaryDeviceId);
    localStorage.setItem('lt_device_id_2', secondaryDeviceId);

    localStorage.setItem('sh_server', shellyServer);
    localStorage.setItem('sh_auth_key', shellyAuthKey);
    localStorage.setItem('sh_high_power', JSON.stringify(highPowerIds));
    localStorage.setItem('sh_low_power', JSON.stringify(lowPowerIds));
    localStorage.setItem('sh_flood', JSON.stringify(floodSensorIds));

    localStorage.setItem('lt_notif_enabled', notificationsEnabled.toString());
    localStorage.setItem('lt_notif_ag', notifyAutoGuard.toString());
    localStorage.setItem('lt_alert_offline', alertOffline.toString());
    localStorage.setItem('lt_notif_batt', notifyLowBattery.toString());
    localStorage.setItem('lt_notif_water', notifyWatering.toString());
    localStorage.setItem('lt_notif_flood', notifyFlood.toString());
    localStorage.setItem('lt_notif_house_batt', notifyHouseBatt.toString());
    localStorage.setItem('lt_notif_engine_batt', notifyEngineBatt.toString());
    localStorage.setItem('lt_notif_shore', notifyShorePower.toString());
    localStorage.setItem('lt_alarm_sound', alarmSound);
    localStorage.setItem('lt_alarm_vol', alarmVolume.toString());
    localStorage.setItem('lt_alarm_repeat', alarmRepeatInterval);

    localStorage.setItem('lt_max_flow', maxFlowRate.toString());
    localStorage.setItem('lt_max_dur', maxDuration.toString());
    localStorage.setItem('lt_auto_guard', autoGuardEnabled.toString());

    localStorage.setItem('lt_batt_type', battType);
    localStorage.setItem('lt_batt_system_v', battSystemV);
    localStorage.setItem('lt_batt_low_v', battLowVoltage.toString());
    localStorage.setItem('lt_batt_crit_v', battCritVoltage.toString());
    localStorage.setItem('lt_batt_normal_v', battNormalVoltage.toString());
    localStorage.setItem('lt_batt_over_v', battOverVoltage.toString());
    localStorage.setItem('lt_batt_charge_v', battChargeVoltage.toString());
    localStorage.setItem('lt_shore_crit_low_v', shoreCritLowV.toString());
    localStorage.setItem('lt_shore_low_v', shoreLowV.toString());
    localStorage.setItem('lt_shore_normal_v', shoreNormalV.toString());
    localStorage.setItem('lt_shore_high_v', shoreHighV.toString());
    localStorage.setItem('lt_shore_crit_high_v', shoreCritHighV.toString());

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
    maxFlowRate, maxDuration, autoGuardEnabled,
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
        const gateways: {id: string, name: string}[] = [];
        const taplinkers: {id: string, name: string, gatewayId: string}[] = [];

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
    } catch(e: any) {
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
  const deviceLocalHost = (d: DeviceConfig) =>
    d.localIp || (d.shellyDeviceId && /shelly/i.test(d.shellyDeviceId) ? `${d.shellyDeviceId.toLowerCase()}.local` : '');

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

  const handleSwitchVehicle = (vid: string) => {
    switchVehicle(vid);
    // State will naturally update via the settings_updated event listener
  };

  const handleAddNewVehicle = () => {
    setNewVehicleNameInput('');
    setShowNewVehicleModal(true);
  };

  const confirmAddNewVehicle = () => {
    const newVid = addNewVehicle(newVehicleNameInput || 'New Vehicle');
    switchVehicle(newVid);
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

  // Find the device's voltmeter component id (peripheral-linked → usually 100).
  const findVoltmeterId = (status: any): number | null => {
    for (const k of Object.keys(status || {})) {
      const m = /^voltmeter:(\d+)$/.exec(k);
      if (m) return Number(m[1]);
    }
    return null;
  };

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
    deleteVehicle(idToDelete);                       // local removal + tombstone + switch to fallback
    deleteVehicleConfig(idToDelete).catch(() => {}); // remove self from cloud allowedUsers
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
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ marginTop: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', margin: 0 }}>Vehicles</h3>

            {/* Per-vehicle plan + upgrade link (full comparison lives on the marketing pricing page) */}
            <PlanBadge />
            
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '8px' }}>
              <div style={{ flex: 1 }}>
                 <label className="form-label" style={{ marginBottom: '8px' }}>Active Vehicle Profile</label>
                 <select className="form-input" value={selectedVid} onChange={(e) => setSelectedVid(e.target.value)}>
                   {Object.values(vehiclesMap).map(v => (
                     <option key={v.id} value={v.id}>
                       {v.config.lt_vessel_name || v.id} {v.id === activeVid ? '(Active)' : ''}
                     </option>
                   ))}
                 </select>
              </div>
              <button 
                className="btn-secondary" 
                onClick={() => handleSwitchVehicle(selectedVid)} 
                disabled={selectedVid === activeVid}
                style={{ padding: '8px 16px', fontSize: '0.85rem' }}
              >
                Switch
              </button>
              <button 
                className="btn-primary" 
                onClick={handleAddNewVehicle}
                style={{ padding: '8px 16px', fontSize: '0.85rem' }}
              >
                + New
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label className="form-label">Vessel / Vehicle Nickname</label>
                  {isEditingName ? (
                    <input type="text" className="form-input" placeholder="e.g. My Boat or RV" value={vesselNickname} onChange={(e) => setVesselNickname(e.target.value)} autoFocus />
                  ) : (
                    <div className="form-input" style={{ opacity: 0.8, height: '42px', display: 'flex', alignItems: 'center' }}>{vesselNickname || 'Unnamed Vessel'}</div>
                  )}
                </div>
                <button
                  className={isEditingName ? "btn-primary" : "btn-secondary"}
                  onClick={() => setIsEditingName(!isEditingName)}
                  style={{ padding: '8px 16px', height: '42px' }}
                >
                  {isEditingName ? 'Save' : 'Edit'}
                </button>
              </div>

              <div>
                <label className="form-label">Shelly Local Password</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <input
                      className="form-input"
                      type={showShellyPw ? 'text' : 'password'}
                      value={isEditingShellyPw ? shellyPwDraft : shellyLocalPassword}
                      onChange={(e) => setShellyPwDraft(e.target.value)}
                      readOnly={!isEditingShellyPw}
                      placeholder="Auto-generated per vehicle"
                      style={{ paddingRight: '44px', width: '100%', fontFamily: 'monospace', opacity: isEditingShellyPw ? 1 : 0.75 }}
                    />
                    <button type="button" onClick={() => setShowShellyPw(s => !s)} aria-label={showShellyPw ? 'Hide' : 'Show'}
                      style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '4px' }}>
                      {showShellyPw ? '🙈' : '👁️'}
                    </button>
                  </div>
                  {isEditingShellyPw && (
                    <button className="btn-secondary" style={{ padding: '8px 12px', height: '42px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                      onClick={async () => { const { generateShellyPassword } = await import('../utils/VehicleManager'); setShellyPwDraft(generateShellyPassword()); }}>
                      🎲 Regenerate
                    </button>
                  )}
                  <button className={isEditingShellyPw ? 'btn-primary' : 'btn-secondary'} style={{ padding: '8px 16px', height: '42px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                    onClick={() => isEditingShellyPw ? requestSaveShellyPw() : startEditShellyPw()}>
                    {isEditingShellyPw ? 'Save' : 'Edit'}
                  </button>
                  {isEditingShellyPw && (
                    <button className="btn-secondary" style={{ padding: '8px 12px', height: '42px', fontSize: '0.8rem' }}
                      onClick={() => { setIsEditingShellyPw(false); setPwChangeMsg(null); }}>
                      Cancel
                    </button>
                  )}
                </div>
                {pwChangeMsg && (
                  <p style={{ fontSize: '0.78rem', color: pwChangeMsg.ok ? 'var(--success-color, #10b981)' : '#ffb3b3', margin: '6px 0 0 0' }}>{pwChangeMsg.text}</p>
                )}
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '6px 0 0 0' }}>
                  Set on your Shelly devices during setup and used for secure local access. Shared across this vehicle's devices. Changing it here pushes the new password to every Shelly device on this vehicle.
                </p>
              </div>

              {/* Advanced Vehicle Settings (Custom Cloud Server URL, etc.) — collapsed by default. */}
              <div>
                <button type="button" className="btn-secondary"
                  onClick={() => setShowAdvanced(s => !s)}
                  style={{ fontSize: '0.85rem', padding: '8px 14px' }}>
                  {showAdvanced ? '▾' : '▸'} Advanced Vehicle Settings
                </button>
                {showAdvanced && (
                  <div style={{ marginTop: '12px' }}>
                    <label className="form-label" style={{ fontWeight: 600 }}>Custom Cloud Server URL</label>
                    <label className="form-label">Cloud Alert Worker URL</label>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 6px 0' }}>
                      For users running their own cloud server (the self-hostable Guardian cloud server, or a Cloudflare worker). Required for Shelly devices to push away-from-home alerts. Leave all three blank to use the default hosted server. Set this before adding devices.
                    </p>
                    <input className="form-input" type="url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://your-server.example.com (blank = default server)" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                    <label className="form-label" style={{ marginTop: '12px' }}>Username</label>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 6px 0' }}>
                      The username created in your server's admin page. Leave blank if your server doesn't require auth.
                    </p>
                    <input className="form-input" type="text" value={webhookUser} onChange={(e) => setWebhookUser(e.target.value)} placeholder="self-host server username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" />
                    <label className="form-label" style={{ marginTop: '12px' }}>API Key</label>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 6px 0' }}>
                      The API key paired with that username. Stored with this vehicle and used to authenticate to your server.
                    </p>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input className="form-input" type={showWebhookKey ? 'text' : 'password'} value={webhookKey} onChange={(e) => setWebhookKey(e.target.value)} placeholder="self-host server API key" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" style={{ flex: 1 }} />
                      <button type="button" className="btn-secondary" onClick={() => setShowWebhookKey(s => !s)} style={{ fontSize: '0.8rem', padding: '8px 12px' }}>{showWebhookKey ? 'Hide' : 'Show'}</button>
                    </div>
                  </div>
                )}
              </div>
          </div>

          {/* Account Information (moved below Vehicles) */}
          <div className="glass-card">
          <h3 style={{ marginTop: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', marginBottom: '16px' }}>Account Information</h3>
          {!user ? (
            <div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
                Sign in to Boat-RV-Guardian to enable remote monitoring, cloud synchronization of your settings, and push notifications when you are away from the local network.
              </p>
              {!showLogin ? (
                <button 
                  className="btn-primary"
                  onClick={() => setShowLogin(true)}
                  style={{ marginTop: '16px' }}
                >
                  Log into Boat-RV-Guardian.com
                </button>
              ) : (
                <div style={{ marginTop: '20px', background: 'rgba(0,0,0,0.2)', padding: '15px', borderRadius: '12px' }}>
                  <Login />
                  <div style={{ textAlign: 'center', marginTop: '10px' }}>
                    <button className="btn-secondary" onClick={() => setShowLogin(false)} style={{ fontSize: '0.85rem' }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <p style={{ margin: 0 }}><strong>Email:</strong> {user.email}</p>
                <button 
                  className="btn-secondary"
                  onClick={() => signOut(auth)}
                  style={{ border: '1px solid #ef4444', color: '#ef4444', padding: '4px 12px', fontSize: '0.8rem' }}
                >
                  Sign Out
                </button>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', cursor: 'pointer' }}>
                    <span style={{ fontWeight: 600 }}>Sync settings with the cloud</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Automatically backup and restore your configuration</span>
                  </label>
                  <input type="checkbox" checked={syncSettingsCloud} onChange={(e) => setSyncSettingsCloud(e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--accent-cyan)' }} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', cursor: 'pointer' }}>
                    <span style={{ fontWeight: 600 }}>Store historical data in the cloud</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Sync your water flow history for long-term storage</span>
                  </label>
                  <input type="checkbox" checked={storeHistoryCloud} onChange={(e) => setStoreHistoryCloud(e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--accent-cyan)' }} />
                </div>
              </div>

              {/* Startup vehicle: open the last-used vehicle, or always a specific default. */}
              {(() => {
                const vehicles = Object.values(vehiclesMap);
                if (vehicles.length === 0) return null;
                const mode = userConfig?.startupMode || 'default';
                // Auto-pick the first vehicle if the account has no preference set yet
                const effectiveDefault = userConfig?.activeVehicleId || vehicles[0]?.id || '';
                return (
                  <div style={{ marginTop: '16px' }}>
                    <label className="form-label" style={{ marginBottom: '4px' }}>When the app opens</label>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
                      <div style={{ flex: 1 }}>
                        <select
                          className="form-input"
                          value={mode}
                          onChange={async (e) => {
                            const m = e.target.value as 'default' | 'last';
                            setDefaultVidSaving(true);
                            try {
                              await updateUserConfig(m === 'default'
                                ? { startupMode: 'default', activeVehicleId: effectiveDefault }
                                : { startupMode: 'last' });
                            } finally { setDefaultVidSaving(false); }
                          }}
                        >
                          <option value="last">Last used vehicle</option>
                          <option value="default">A specific vehicle</option>
                        </select>
                      </div>
                      {mode === 'default' && (
                        <div style={{ flex: 1 }}>
                          <select
                            className="form-input"
                            value={effectiveDefault}
                            onChange={async (e) => {
                              setDefaultVidSaving(true);
                              try { await updateUserConfig({ startupMode: 'default', activeVehicleId: e.target.value }); }
                              finally { setDefaultVidSaving(false); }
                            }}
                          >
                            {vehicles.map(v => (
                              <option key={v.id} value={v.id}>{v.config.lt_vessel_name || v.id}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {defaultVidSaving && (
                        <span style={{ fontSize: '0.8rem', color: 'var(--accent-cyan)', paddingBottom: '10px', whiteSpace: 'nowrap' }}>Saving…</span>
                      )}
                    </div>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '6px 0 0 0' }}>
                      {mode === 'default'
                        ? 'Opens this vehicle every time you log in.'
                        : 'Opens whichever vehicle you used last on this device.'}
                    </p>
                  </div>
                );
              })()}

              {/* Manual Sync Button */}
              <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button
                  className="btn-primary"
                  onClick={handleManualSync}
                  disabled={isManualSyncing}
                >
                  {isManualSyncing ? 'Syncing...' : 'Force Cloud Sync'}
                </button>
                {manualSyncMsg && (
                  <div style={{ 
                    fontSize: '0.85rem', textAlign: 'center', padding: '8px', borderRadius: '4px',
                    color: manualSyncMsg.type === 'success' ? '#10b981' : '#ef4444',
                    background: manualSyncMsg.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'
                  }}>
                    {manualSyncMsg.text}
                  </div>
                )}
              </div>

            </div>
          )}
        </div>

          {/* Local Server (moved above Notifications, below Account Info) */}
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <h3 style={{ marginTop: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', margin: 0 }}>📡 Local Server</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
              This device can run a local listener so battery sensors (e.g. flood) push alerts straight to it over your LAN — works with no internet, no Bluetooth required.
            </p>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', cursor: 'pointer' }}>
              <span>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Enable local sensor server</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Listen for local sensor webhooks on this device.</div>
              </span>
              <input type="checkbox" checked={localServerEnabled} onChange={e => setLocalServerEnabled(e.target.checked)} style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: 'var(--accent-emerald)' }} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', cursor: localServerEnabled ? 'pointer' : 'not-allowed', opacity: localServerEnabled ? 1 : 0.5 }}>
              <span>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Run in the background</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Keep the server alive when the app is closed so local alerts arrive even offline. On Android this runs a foreground service with a persistent notification and uses more battery. When off, the local server only runs while the app is open.</div>
              </span>
              <input type="checkbox" disabled={!localServerEnabled} checked={localServerBackground} onChange={e => setLocalServerBackground(e.target.checked)} style={{ width: '20px', height: '20px', cursor: localServerEnabled ? 'pointer' : 'not-allowed', accentColor: 'var(--accent-emerald)' }} />
            </label>
          </div>

          {/* Device Preferences — local to this device, not synced to cloud */}
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <h3 style={{ marginTop: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', margin: '0 0 4px 0' }}>Device Preferences</h3>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Saved on this device only — not synced to the cloud.</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label className="form-label">Units</label>
                <select className="form-input" value={unitSystem} onChange={(e) => setUnitSystem(e.target.value as 'metric' | 'imperial')}>
                  <option value="metric">Metric (Liters)</option>
                  <option value="imperial">Imperial (Gallons)</option>
                </select>
              </div>
              <div>
                <label className="form-label">Time Zone</label>
                <select className="form-input" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
                  {(Intl as any).supportedValuesOf ? (Intl as any).supportedValuesOf('timeZone').map((tz: string) => (
                    <option key={tz} value={tz}>{tz}</option>
                  )) : <option value={timeZone}>{timeZone}</option>}
                </select>
              </div>
            </div>

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>Notifications & Alarms</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.85rem', color: notificationsEnabled ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>{notificationsEnabled ? 'ENABLED' : 'DISABLED'}</span>
                <input type="checkbox" checked={notificationsEnabled} onChange={(e) => setNotificationsEnabled(e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--accent-cyan)' }} />
              </div>
            </div>

            <h4 style={{ margin: '8px 0 0', fontSize: '1rem', color: 'var(--text-secondary)' }}>Fresh Water</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px' }}>
               <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                 <input type="checkbox" checked={notifyAutoGuard} onChange={(e) => setNotifyAutoGuard(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-cyan)' }} />
                 <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Auto-Guard Triggers</span>
               </label>
               <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                 <input type="checkbox" checked={alertOffline} onChange={(e) => setAlertOffline(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-orange)' }} />
                 <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Device Offline</span>
               </label>
               <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                 <input type="checkbox" checked={notifyWatering} onChange={(e) => setNotifyWatering(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: 'var(--text-secondary)' }} />
                 <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Water Start/Stop</span>
               </label>
            </div>

            <h4 style={{ margin: '8px 0 0', fontSize: '1rem', color: 'var(--text-secondary)' }}>High Water/Flood</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px' }}>
               <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                 <input type="checkbox" checked={notifyFlood} onChange={(e) => setNotifyFlood(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-cyan)' }} />
                 <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Bilge/Flood Sensor Triggered</span>
               </label>
            </div>

            <h4 style={{ margin: '8px 0 0', fontSize: '1rem', color: 'var(--text-secondary)' }}>Batteries</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px' }}>
               <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                 <input type="checkbox" checked={notifyLowBattery} onChange={(e) => setNotifyLowBattery(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-orange)' }} />
                 <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Fresh Water Valve Low Battery</span>
               </label>
               <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                 <input type="checkbox" checked={notifyHouseBatt} onChange={(e) => setNotifyHouseBatt(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-orange)' }} />
                 <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>House Battery Low (&lt;12.0V)</span>
               </label>
               <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                 <input type="checkbox" checked={notifyEngineBatt} onChange={(e) => setNotifyEngineBatt(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-orange)' }} />
                 <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Engine Battery Low (&lt;12.0V)</span>
               </label>
            </div>

            <h4 style={{ margin: '8px 0 0', fontSize: '1rem', color: 'var(--text-secondary)' }}>Shore Power</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px' }}>
               <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                 <input type="checkbox" checked={notifyShorePower} onChange={(e) => setNotifyShorePower(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-orange)' }} />
                 <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Shore Power Disconnected</span>
               </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label className="form-label">Warning Alarm Sound</label>
                <select className="form-input" value={alarmSound} onChange={(e) => setAlarmSound(e.target.value as any)}>
                  <option value="siren">🚨 Siren (Loud)</option>
                  <option value="beep">⚠️ Beep (Standard)</option>
                  <option value="off">🔇 Silent</option>
                </select>
              </div>
              <div>
                <label className="form-label">Alarm Repeat</label>
                <select className="form-input" value={alarmRepeatInterval} onChange={(e) => setAlarmRepeatInterval(e.target.value as any)}>
                  <option value="once">Once</option>
                  <option value="5">Every 5 Seconds</option>
                  <option value="15">Every 15 Seconds</option>
                  <option value="30">Every 30 Seconds</option>
                  <option value="60">Every 60 Seconds</option>
                </select>
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}><span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Alarm Volume</span><span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>{Math.round(alarmVolume * 100)}%</span></div>
              <input type="range" min="0.1" max="1.0" step="0.1" className="form-input" style={{ padding: 0 }} value={alarmVolume} onChange={(e) => setAlarmVolume(Number(e.target.value))} />
            </div>
            </div>
          </div>

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
              You cannot delete your only vehicle. Add another vehicle first.
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
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', padding: '40px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '3rem', marginBottom: '8px' }}>➕</div>
              <h3 style={{ margin: 0, color: 'var(--accent-cyan)' }}>Add a New Device</h3>
              <p style={{ color: 'var(--text-secondary)', maxWidth: '400px', marginBottom: '24px' }}>
                Select the type of device you want to add to this vehicle.
              </p>
              
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button className="btn-secondary" onClick={() => setIsProvisionLinkTapModalOpen(true)} style={{ padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', width: '200px' }}>
                  <span style={{ fontSize: '2rem' }}>🚰</span>
                  <strong>LinkTap Valve</strong>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Water Shutoff Valve</span>
                </button>
                <button className="btn-secondary" onClick={() => setIsProvisionModalOpen(true)} style={{ padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', width: '200px', borderColor: '#f59e0b' }}>
                  <span style={{ fontSize: '2rem' }}>⚡</span>
                  <strong style={{ color: '#f59e0b' }}>Shelly Sensor</strong>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Power, Voltage, or Flood</span>
                </button>
              </div>
            </div>
          )}

          {devicesTab === 'auth' && (
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>LinkTap Credentials</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className={`status-dot ${connectionStatus === 'connected' ? 'online' : connectionStatus}`}></span>
                <span style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>
                  {connectionStatus === 'connected' ?
                    (isCloudPollingActive && isLocalPollingActive ? 'CLOUD & LOCAL CONNECTED' :
                    isCloudPollingActive ? 'CLOUD ONLY CONNECTED' :
                    isLocalPollingActive ? 'LOCAL ONLY CONNECTED' : 'CONNECTED') :
                   connectionStatus === 'connecting' ? 'CONNECTING...' : ''}
                </span>
              </div>
            </div>
            
            <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h4 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent-cyan)', margin: 0 }}>☁️ Cloud Controller</h4>
                    <button
                      className={!isCloudPollingActive ? "btn-primary" : "btn-secondary"}
                      onClick={() => {
                        setIsCloudPollingActive(!isCloudPollingActive);
                        if (!isCloudPollingActive && cloudUsername && cloudApiKey) handleRetrieveFromCloud();
                      }}
                      style={{ padding: '4px 12px', fontSize: '0.75rem', fontWeight: 700 }}
                    >
                      {!isCloudPollingActive ? 'Connect' : '✓ Connected'}
                    </button>
                  </div>
                  <div><label className="form-label">Cloud Username</label><input type="text" className="form-input" value={cloudUsername} onChange={(e) => { setCloudUsername(e.target.value); setIsCloudPollingActive(false); }} placeholder="App Username" /></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label className="form-label" style={{ marginBottom: 0 }}>Cloud API Key</label>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <input type={showCloudApiKey ? "text" : "password"} className="form-input" value={cloudApiKey} onChange={(e) => { setCloudApiKey(e.target.value); setIsCloudPollingActive(false); }} placeholder="Paste API Key" style={{ paddingRight: '40px' }} />
                      <button
                        className="btn-secondary"
                        onClick={() => setShowCloudApiKey(!showCloudApiKey)}
                        style={{ position: 'absolute', right: '8px', background: 'transparent', border: 'none', padding: '4px', cursor: 'pointer', opacity: 0.6 }}
                      >
                        {showCloudApiKey ? '👁️' : '👁️‍🗨️'}
                      </button>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: '1.4' }}>
                      ℹ️ Generate an API Key by visiting <a href="https://www.link-tap.com/#!/api-for-developers" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-cyan)', textDecoration: 'none' }}>LinkTap API for Developers</a>.
                    </div>
                  </div>
                </div>

                {/* Retrieve devices from cloud — shared discovery action, centered between the two controllers */}
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <button
                    className="btn-secondary"
                    onClick={handleRetrieveFromCloud}
                    disabled={isDiscovering || !cloudUsername || !cloudApiKey}
                    style={{ padding: '8px 18px', fontSize: '0.8rem' }}
                  >
                    {isDiscovering ? 'Retrieving...' : '⬇️ Retrieve Devices from Cloud'}
                  </button>
                </div>

                {/* Local Gateway Control */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h4 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent-emerald)', margin: 0 }}>🏠 Local Gateway Control</h4>
                    <button
                      className={!isLocalPollingActive ? "btn-primary" : "btn-secondary"}
                      onClick={() => setIsLocalPollingActive(!isLocalPollingActive)}
                      disabled={!gatewayIp}
                      title={!gatewayIp ? 'Enter or scan for a Gateway IP first' : ''}
                      style={{ padding: '4px 12px', fontSize: '0.75rem', fontWeight: 700 }}
                    >
                      {!isLocalPollingActive ? 'Connect' : '✓ Connected'}
                    </button>
                  </div>

                  {discoveryMsg && (
                    <div style={{ fontSize: '0.8rem', color: discoveryMsg.type === 'success' ? 'var(--accent-emerald)' : 'var(--accent-orange)' }}>
                      {discoveryMsg.text}
                    </div>
                  )}

                  {/* Gateway IP */}
                  <div>
                    <label className="form-label">Gateway IP</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input type="text" className="form-input" value={gatewayIp}
                        onChange={(e) => { setGatewayIp(e.target.value); setScanResults([]); }}
                        placeholder="e.g. 192.168.1.100" style={{ flex: 1 }} />
                      <button className="btn-secondary" onClick={handleScanGateway} disabled={isScanningGateway}
                        style={{ padding: '8px 12px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                        {isScanningGateway ? '⏳ Scanning subnet...' : '🔍 Scan for Gateway'}
                      </button>
                    </div>
                    {scanMsg && (
                      <div style={{ fontSize: '0.75rem', color: scanMsg.type === 'success' ? 'var(--accent-emerald)' : 'var(--accent-orange)', marginTop: '4px' }}>
                        {scanMsg.text}
                      </div>
                    )}
                    {scanResults.length > 1 && (
                      <select className="form-input" style={{ marginTop: '8px' }}
                        value={gatewayIp}
                        onChange={(e) => { setGatewayIp(e.target.value); setScanResults([]); setScanMsg(null); }}>
                        <option value="">— Select a gateway —</option>
                        {scanResults.map(ip => (
                          <option key={ip} value={ip}>{ip}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Gateway ID */}
                  <div>
                    <label className="form-label">Gateway ID</label>
                    {cloudGateways.length > 0 && !gatewayIdManual ? (
                      <select className="form-input" value={gatewayId}
                        onChange={(e) => {
                          if (e.target.value === '__manual__') { setGatewayIdManual(true); }
                          else setGatewayId(e.target.value);
                        }}>
                        <option value="">— Select a Gateway —</option>
                        {cloudGateways.map(gw => (
                          <option key={gw.id} value={gw.id}>{gw.name !== gw.id ? `${gw.name} (${gw.id})` : gw.id}</option>
                        ))}
                        <option value="__manual__">✏️ Enter manually...</option>
                      </select>
                    ) : (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input type="text" className="form-input" value={gatewayId}
                          onChange={(e) => setGatewayId(e.target.value)}
                          placeholder="16-char hex Gateway ID" style={{ flex: 1 }} />
                        {cloudGateways.length > 0 && (
                          <button className="btn-secondary" onClick={() => setGatewayIdManual(false)}
                            style={{ padding: '6px 10px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>← List</button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Device IDs */}
                  {primaryDeviceId && secondaryDeviceId && primaryDeviceId === secondaryDeviceId && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--accent-orange)', background: 'rgba(251,146,60,0.1)', border: '1px solid rgba(251,146,60,0.3)', borderRadius: '8px', padding: '8px 12px' }}>
                      ⚠️ Device ID 1 and Device ID 2 are the same — each field must reference a different TapLinker.
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label className="form-label">TapLinker Device ID 1</label>
                      {cloudTaplinkers.length > 0 && !device1Manual ? (
                        <select className="form-input" value={primaryDeviceId}
                          onChange={(e) => {
                            if (e.target.value === '__manual__') { setDevice1Manual(true); }
                            else setPrimaryDeviceId(e.target.value);
                          }}>
                          <option value="">— Select a Device —</option>
                          {cloudTaplinkers.filter(tap => tap.id !== secondaryDeviceId).map(tap => (
                            <option key={tap.id} value={tap.id}>{tap.name !== tap.id ? `${tap.name} (${tap.id})` : tap.id}</option>
                          ))}
                          <option value="__manual__">✏️ Enter manually...</option>
                        </select>
                      ) : (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input type="text" className="form-input" value={primaryDeviceId}
                            onChange={(e) => setPrimaryDeviceId(e.target.value)}
                            placeholder="16-char hex Device ID" style={{ flex: 1 }} />
                          {cloudTaplinkers.length > 0 && (
                            <button className="btn-secondary" onClick={() => setDevice1Manual(false)}
                              style={{ padding: '6px 10px', fontSize: '0.8rem' }}>← List</button>
                          )}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="form-label">TapLinker Device ID 2</label>
                      {cloudTaplinkers.length > 0 && !device2Manual ? (
                        <select className="form-input" value={secondaryDeviceId}
                          onChange={(e) => {
                            if (e.target.value === '__manual__') { setDevice2Manual(true); }
                            else setSecondaryDeviceId(e.target.value);
                          }}>
                          <option value="">— Select a Device (optional) —</option>
                          {cloudTaplinkers.filter(tap => tap.id !== primaryDeviceId).map(tap => (
                            <option key={tap.id} value={tap.id}>{tap.name !== tap.id ? `${tap.name} (${tap.id})` : tap.id}</option>
                          ))}
                          <option value="__manual__">✏️ Enter manually...</option>
                        </select>
                      ) : (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input type="text" className="form-input" value={secondaryDeviceId}
                            onChange={(e) => setSecondaryDeviceId(e.target.value)}
                            placeholder="16-char hex (optional)" style={{ flex: 1 }} />
                          {cloudTaplinkers.length > 0 && (
                            <button className="btn-secondary" onClick={() => setDevice2Manual(false)}
                              style={{ padding: '6px 10px', fontSize: '0.8rem' }}>← List</button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
          </div>
          )}

          {devicesTab === 'config' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {[
              { label: 'Fresh Water',      icon: '🚰', color: 'var(--accent-cyan)', match: (d: DeviceConfig) => d.type === 'linktap_valve' },
              { label: 'High Water/Flood', icon: '🌊', color: '#3b82f6',            match: (d: DeviceConfig) => d.role === 'Flood Sensor' },
              { label: 'Batteries',        icon: '🔋', color: '#f59e0b',            match: (d: DeviceConfig) => d.role === 'Low Power Sensor' },
              { label: 'Shore Power',      icon: '⚡', color: '#a855f7',            match: (d: DeviceConfig) => d.role === 'High Power Sensor' },
            ].map(({ label, icon, color, match }) => {
              const catDevices = devices.filter(match);
              return (
                <div key={label} className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <h3 style={{ margin: 0, color, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>{icon} {label}</h3>
                  {catDevices.length === 0 ? (
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0 }}>No {label.toLowerCase()} devices configured.</p>
                  ) : catDevices.map(device => (
                    <div key={device.id}>
                      {/* Device row */}
                      <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        background: 'rgba(255,255,255,0.03)', padding: '12px 16px',
                        borderRadius: expandedDeviceId === device.id ? '12px 12px 0 0' : '12px',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderBottom: expandedDeviceId === device.id ? 'none' : undefined,
                      }}>
                        <div style={{ opacity: device.enabled === false ? 0.55 : 1 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {device.name || device.role}
                            {device.enabled === false && (
                              <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Disabled</span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            {device.type === 'linktap_valve' ? '🚰 LinkTap Valve' : '⚡ Shelly Sensor'} · {device.linktapDeviceId || device.shellyDeviceId || device.id}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            className={expandedDeviceId === device.id ? 'btn-primary' : 'btn-secondary'}
                            onClick={() => handleExpandDevice(device.id)}
                            title="Device Settings"
                            style={{ padding: '6px 10px', fontSize: '1.1rem', lineHeight: 1 }}
                          >⚙️</button>
                          <button
                            className="btn-secondary"
                            onClick={() => { setDeviceToRemove(device); setFactoryResetOnRemove(false); }}
                            style={{ padding: '6px 10px', fontSize: '0.75rem', borderColor: '#ef4444', color: '#ef4444' }}
                          >Remove</button>
                        </div>
                      </div>

                      {/* Expanded settings panel */}
                      {expandedDeviceId === device.id && (
                        <div style={{
                          background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.1)',
                          borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '16px',
                          display: 'flex', flexDirection: 'column', gap: '16px',
                        }}>
                          {/* Enable / disable — gates polling and startup auto-connect */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '12px 14px' }}>
                            <div>
                              <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>Device Enabled</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                When off, this device isn't polled and is skipped on startup auto-connect.
                              </div>
                            </div>
                            <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                              <input type="checkbox" checked={device.enabled !== false}
                                onChange={(e) => { import('../utils/VehicleManager').then(m => { m.updateDevice(device.id, { enabled: e.target.checked }); setDevices(m.getDevices()); }); }}
                                style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: 'var(--accent-emerald)' }} />
                            </label>
                          </div>

                          {/* Firmware (Shelly devices) */}
                          {device.type === 'shelly_sensor' && (
                            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                <div>
                                  <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>Firmware</div>
                                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                    {device.fwVersion ? `Current: v${device.fwVersion}` : 'Version unknown — check below.'}
                                    {device.fwUpdateVersion ? `  •  ⬆️ v${device.fwUpdateVersion} available` : ''}
                                  </div>
                                </div>
                                <button className="btn-secondary" disabled={fwBusy} onClick={() => handleCheckFirmware(device)}
                                  style={{ padding: '6px 12px', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                                  {fwBusy ? '…' : 'Check for Update'}
                                </button>
                              </div>
                              {device.fwUpdateVersion && (
                                <button className="btn-primary" disabled={fwBusy} onClick={() => handleUpdateFirmware(device)}
                                  style={{ padding: '8px 12px', fontSize: '0.82rem' }}>
                                  ⬆️ Update Firmware to v{device.fwUpdateVersion}
                                </button>
                              )}
                              {fwMsg && expandedDeviceId === device.id && (
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{fwMsg}</div>
                              )}
                            </div>
                          )}

                          {device.type === 'linktap_valve' && (
                            <>
                              {/* Normal Run Profile */}
                              <div style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '8px', padding: '14px' }}>
                                <h4 style={{ margin: '0 0 12px 0', color: 'var(--accent-emerald)', fontSize: '0.95rem', fontWeight: 700 }}>Normal Run Profile</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                  <div>
                                    <label className="form-label">Duration</label>
                                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                      <input type="number" min="0" max="23" disabled={devNormalDaily} className="form-input"
                                        value={devNormalHrs}
                                        onChange={(e) => { const v = Math.min(23, Math.max(0, Number(e.target.value))); setDevNormalHrs(v); saveDeviceNormalRun('lt_norm_hrs', v); }}
                                        style={{ width: '40%', padding: '8px', opacity: devNormalDaily ? 0.5 : 1 }} />
                                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>hrs</span>
                                      <input type="number" min="0" max="59" disabled={devNormalDaily} className="form-input"
                                        value={devNormalMins}
                                        onChange={(e) => { const v = Math.min(59, Math.max(0, Number(e.target.value))); setDevNormalMins(v); saveDeviceNormalRun('lt_norm_mins', v); }}
                                        style={{ width: '40%', padding: '8px', opacity: devNormalDaily ? 0.5 : 1 }} />
                                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>mins</span>
                                    </div>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px', cursor: 'pointer' }}>
                                      <input type="checkbox" checked={devNormalDaily}
                                        onChange={(e) => { setDevNormalDaily(e.target.checked); saveDeviceNormalRun('lt_norm_daily', e.target.checked); }}
                                        style={{ width: '16px', height: '16px', accentColor: 'var(--accent-cyan)' }} />
                                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Daily (run once per day)</span>
                                    </label>
                                  </div>
                                  <div>
                                    <label className="form-label">Volume Limit ({volUnit})</label>
                                    <input type="number" min="1" className="form-input" value={devNormalVol}
                                      onChange={(e) => { const v = Math.max(1, Number(e.target.value)); setDevNormalVol(v); saveDeviceNormalRun('lt_norm_vol', v); }} />
                                  </div>
                                </div>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', cursor: 'pointer' }}>
                                  <input type="checkbox" checked={devAutoRestart}
                                    onChange={(e) => { setDevAutoRestart(e.target.checked); saveDeviceNormalRun('lt_auto_restart', e.target.checked); }}
                                    style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--accent-cyan)' }} />
                                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Auto-restart profile automatically when time expires</span>
                                </label>
                              </div>

                              {/* Safety Limits */}
                              <div>
                                <h4 style={{ margin: '0 0 10px 0', color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: 600 }}>Safety Limits</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                  <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Max Flow Speed Limit</span>
                                      <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>{device.maxFlowRate || 15} {unitSystem === 'metric' ? 'L/min' : 'Gal/min'}</span>
                                    </div>
                                    <input type="range" min="5" max="35" className="form-input" style={{ padding: 0 }}
                                      value={device.maxFlowRate || 15}
                                      onChange={(e) => { import('../utils/VehicleManager').then(m => { m.updateDevice(device.id, { maxFlowRate: Number(e.target.value) }); setDevices(m.getDevices()); }); }} />
                                  </div>
                                  <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Max Continuous Open</span>
                                      <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>{device.maxDuration || 30} Mins</span>
                                    </div>
                                    <input type="range" min="5" max="120" className="form-input" style={{ padding: 0 }}
                                      value={device.maxDuration || 30}
                                      onChange={(e) => { import('../utils/VehicleManager').then(m => { m.updateDevice(device.id, { maxDuration: Number(e.target.value) }); setDevices(m.getDevices()); }); }} />
                                  </div>
                                </div>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', cursor: 'pointer' }}>
                                  <input type="checkbox" checked={device.autoGuardEnabled !== false}
                                    onChange={(e) => { import('../utils/VehicleManager').then(m => { m.updateDevice(device.id, { autoGuardEnabled: e.target.checked }); setDevices(m.getDevices()); }); }}
                                    style={{ width: '16px', height: '16px', accentColor: 'var(--accent-cyan)', cursor: 'pointer' }} />
                                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Enable Auto-Guard Flooding Sentry for this valve</span>
                                </label>
                              </div>
                            </>
                          )}

                          {device.type === 'shelly_sensor' && (
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                              <div><strong style={{ color: '#fff' }}>Device ID:</strong> {device.shellyDeviceId}</div>
                              <div><strong style={{ color: '#fff' }}>Role:</strong> {device.role}</div>

                              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                                <span>🔋 Battery-powered (don't poll — alerts via push)</span>
                                <input type="checkbox" checked={device.batteryPowered !== false && (device.batteryPowered === true || device.role === 'Flood Sensor')}
                                  onChange={(e) => { import('../utils/VehicleManager').then(m => { m.updateDevice(device.id, { batteryPowered: e.target.checked }); setDevices(m.getDevices()); }); }}
                                  style={{ width: '16px', height: '16px', accentColor: 'var(--accent-cyan)' }} />
                              </label>

                              <div>
                                <label className="form-label" style={{ marginBottom: '4px' }}>Local IP Address</label>
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 6px 0' }}>
                                  Set this so the app can poll the device directly on your network (faster than cloud).
                                </p>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <input
                                    className="form-input"
                                    placeholder="e.g. 192.168.1.50"
                                    defaultValue={device.localIp || ''}
                                    onBlur={(e) => { import('../utils/VehicleManager').then(m => { m.updateDevice(device.id, { localIp: e.target.value.trim() }); setDevices(m.getDevices()); }); }}
                                    style={{ flex: 1 }}
                                  />
                                  <button
                                    className="btn-secondary"
                                    disabled={devicePanelBusy || !device.localIp}
                                    style={{ padding: '6px 12px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                                    onClick={async () => {
                                      setDevicePanelBusy(true); setDevicePanelMsg(null);
                                      try {
                                        const { shellyRpc } = await import('../utils/shellyRpc');
                                        const info = await shellyRpc(device.localIp!, 'Shelly.GetDeviceInfo', {}, localStorage.getItem('sh_local_password') || undefined);
                                        setDevicePanelMsg({ id: device.id, text: `✓ Reachable — ${info?.model || info?.app || info?.id || 'Shelly'}`, ok: true });
                                      } catch (err: any) {
                                        setDevicePanelMsg({ id: device.id, text: `✗ ${err?.message || 'Unreachable'}`, ok: false });
                                      } finally { setDevicePanelBusy(false); }
                                    }}
                                  >Test</button>
                                </div>
                              </div>

                              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                <button
                                  className="btn-secondary"
                                  disabled={devicePanelBusy || !device.localIp || !device.shellyDeviceId}
                                  style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                                  onClick={async () => {
                                    setDevicePanelBusy(true); setDevicePanelMsg(null);
                                    try {
                                      const { shellySetPassword } = await import('../utils/shellyRpc');
                                      const pw = localStorage.getItem('sh_local_password') || '';
                                      if (!pw) throw new Error('No vehicle password set');
                                      await shellySetPassword(device.localIp!, device.shellyDeviceId!, pw);
                                      setDevicePanelMsg({ id: device.id, text: '✓ Device secured with the vehicle password.', ok: true });
                                    } catch (err: any) {
                                      setDevicePanelMsg({ id: device.id, text: `✗ ${err?.message || 'Failed'}`, ok: false });
                                    } finally { setDevicePanelBusy(false); }
                                  }}
                                >🔒 Secure with vehicle password</button>
                                <button
                                  className="btn-secondary"
                                  disabled={devicePanelBusy || !device.localIp}
                                  style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                                  onClick={async () => {
                                    setDevicePanelBusy(true); setDevicePanelMsg(null);
                                    try {
                                      const { shellyClearPassword } = await import('../utils/shellyRpc');
                                      await shellyClearPassword(device.localIp!, localStorage.getItem('sh_local_password') || '');
                                      setDevicePanelMsg({ id: device.id, text: '✓ Password cleared.', ok: true });
                                    } catch (err: any) {
                                      setDevicePanelMsg({ id: device.id, text: `✗ ${err?.message || 'Failed'}`, ok: false });
                                    } finally { setDevicePanelBusy(false); }
                                  }}
                                >Clear password</button>
                              </div>

                              {/* Shelly Plus Uni's 0-30 V voltmeter isn't enabled by default — it must be
                                  linked as a peripheral (creates voltmeter:1xx; reboots the device).
                                  Provisioning does this automatically; this re-runs it for devices added
                                  before the fix or after a factory reset. */}
                              {device.role === 'Low Power Sensor' && (
                                <div>
                                  <button
                                    className="btn-secondary"
                                    disabled={devicePanelBusy || !deviceLocalHost(device)}
                                    style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                                    onClick={async () => {
                                      const host = deviceLocalHost(device);
                                      if (!host) return;
                                      setDevicePanelBusy(true); setDevicePanelMsg(null);
                                      try {
                                        const { shellyRpc, enableShellyVoltmeter } = await import('../utils/shellyRpc');
                                        const pw = localStorage.getItem('sh_local_password') || undefined;
                                        const { id, rebooted } = await enableShellyVoltmeter((m, p) => shellyRpc(host, m, p, pw));
                                        setDevicePanelMsg(id != null
                                          ? { id: device.id, text: rebooted
                                              ? `✓ Voltmeter enabled (voltmeter:${id}) — device rebooting (~15 s), then voltage appears.`
                                              : `✓ Voltmeter already enabled (voltmeter:${id}).`, ok: true }
                                          : { id: device.id, text: '✗ Could not enable the voltmeter — this device may not expose one.', ok: false });
                                      } catch (err: any) {
                                        setDevicePanelMsg({ id: device.id, text: `✗ ${err?.message || 'Unreachable'}${device.batteryPowered ? ' — wake the device and retry' : ''}`, ok: false });
                                      } finally { setDevicePanelBusy(false); }
                                    }}
                                  >🔌 Enable voltmeter</button>
                                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                                    For Shelly Plus Uni battery monitors reading 0.00 V — links the 0-30 V voltmeter peripheral (reboots the device).
                                  </p>
                                </div>
                              )}

                              {/* Voltage calibration — a single offset written ONTO the device (Voltmeter
                                  xvoltage), so local + cloud both report the corrected value. */}
                              {device.role === 'Low Power Sensor' && (
                                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '12px' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <strong style={{ color: '#fff', fontSize: '0.85rem' }}>🎯 Voltage calibration</strong>
                                    <button className="btn-secondary" disabled={devicePanelBusy || !deviceLocalHost(device)}
                                      style={{ padding: '4px 10px', fontSize: '0.72rem' }} onClick={() => readVoltNow(device)}>
                                      🔄 Read now{voltReadMsg[device.id] ? `: ${voltReadMsg[device.id]}` : ''}
                                    </button>
                                  </div>
                                  <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '4px 0 8px 0' }}>
                                    Correction offset for the Shelly Plus Uni voltmeter, written to the device — so the app and the cloud both read the corrected voltage. Offset = (true voltage) − (device reading). Set 0 to clear.
                                  </p>
                                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <div style={{ position: 'relative', width: '140px' }}>
                                      <input className="form-input" type="number" step="0.01" placeholder="e.g. 0.32"
                                        value={offsetDraft[device.id] ?? (device.voltCalOffset != null ? String(device.voltCalOffset) : '')}
                                        onChange={(e) => setOffsetDraft((prev) => ({ ...prev, [device.id]: e.target.value }))}
                                        style={{ paddingRight: '28px' }} />
                                      <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: 'var(--text-secondary)', pointerEvents: 'none' }}>V</span>
                                    </div>
                                    <button className="btn-primary" disabled={devicePanelBusy} style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => applyVoltOffset(device)}>Apply</button>
                                    <button className="btn-secondary" disabled={devicePanelBusy} style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                                      onClick={() => { setOffsetDraft((prev) => ({ ...prev, [device.id]: '0' })); applyVoltOffset(device, 0); }}>Clear</button>
                                  </div>
                                </div>
                              )}

                              {devicePanelMsg?.id === device.id && (
                                <div style={{ fontSize: '0.8rem', color: devicePanelMsg.ok ? '#10b981' : '#ef4444' }}>{devicePanelMsg.text}</div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}

            {devices.length === 0 && (
              <div className="glass-card" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-secondary)' }}>
                No devices configured. Go to "+ Add a device" to get started.
              </div>
            )}
          </div>
          )}

          {devicesTab === 'advanced' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Fresh Water */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h3 style={{ marginTop: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', margin: 0 }}>Fresh Water</h3>
              <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.9rem' }}>
                Normal Run Profile settings are now configured per device. Go to <strong>Configuration</strong> → select a valve → tap the ⚙️ gear icon.
              </p>
            </div>

            {/* High Water/Flood */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h3 style={{ marginTop: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', margin: 0 }}>High Water/Flood</h3>
              <p style={{ color: 'var(--text-secondary)', margin: 0 }}>No advanced settings currently available.</p>
            </div>

            {/* Batteries */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h3 style={{ marginTop: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', margin: 0 }}>Batteries</h3>
              <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.85rem' }}>Alert thresholds applied to house and engine battery sensors.</p>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
                <div>
                  <label className="form-label">Battery Type</label>
                  <select className="form-input" value={battType} onChange={(e) => applyBatteryPreset(e.target.value, battSystemV)}>
                    {Object.entries(BATTERY_PRESETS).map(([key, p]) => (
                      <option key={key} value={key}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">System</label>
                  <select className="form-input" value={battSystemV} onChange={(e) => applyBatteryPreset(battType, e.target.value)}>
                    <option value="12">12 V</option>
                    <option value="24">24 V</option>
                  </select>
                </div>
              </div>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '-6px 0 0 0' }}>
                Choosing a battery type / system fills the thresholds below with recommended values. Pick <strong>Custom (manual)</strong> — or just edit any field — to set your own.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px' }}>
                <div>
                  <label className="form-label">Critical Voltage</label>
                  <div style={{ position: 'relative' }}>
                    <input type="number" min="8" max="35" step="0.1" className="form-input"
                      value={battCritVoltage}
                      onChange={(e) => { setBattCritVoltage(Number(Number(e.target.value).toFixed(1))); setBattType('custom'); }}
                      style={{ paddingRight: '32px' }} />
                    <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: 'var(--text-secondary)', pointerEvents: 'none' }}>V</span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>Triggers critical alarm</div>
                </div>
                <div>
                  <label className="form-label">Low Voltage</label>
                  <div style={{ position: 'relative' }}>
                    <input type="number" min="8" max="35" step="0.1" className="form-input"
                      value={battLowVoltage}
                      onChange={(e) => { setBattLowVoltage(Number(Number(e.target.value).toFixed(1))); setBattType('custom'); }}
                      style={{ paddingRight: '32px' }} />
                    <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: 'var(--text-secondary)', pointerEvents: 'none' }}>V</span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>Triggers low-battery warning</div>
                </div>
                <div>
                  <label className="form-label">Normal Voltage</label>
                  <div style={{ position: 'relative' }}>
                    <input type="number" min="8" max="35" step="0.1" className="form-input"
                      value={battNormalVoltage}
                      onChange={(e) => { setBattNormalVoltage(Number(Number(e.target.value).toFixed(1))); setBattType('custom'); }}
                      style={{ paddingRight: '32px' }} />
                    <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: 'var(--text-secondary)', pointerEvents: 'none' }}>V</span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>Nominal resting voltage</div>
                </div>
                <div>
                  <label className="form-label">Charging</label>
                  <div style={{ position: 'relative' }}>
                    <input type="number" min="8" max="35" step="0.1" className="form-input"
                      value={battChargeVoltage}
                      onChange={(e) => { setBattChargeVoltage(Number(Number(e.target.value).toFixed(1))); setBattType('custom'); }}
                      style={{ paddingRight: '32px' }} />
                    <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: 'var(--text-secondary)', pointerEvents: 'none' }}>V</span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>Indicates charging in progress</div>
                </div>
                <div>
                  <label className="form-label">Over Voltage</label>
                  <div style={{ position: 'relative' }}>
                    <input type="number" min="8" max="35" step="0.1" className="form-input"
                      value={battOverVoltage}
                      onChange={(e) => { setBattOverVoltage(Number(Number(e.target.value).toFixed(1))); setBattType('custom'); }}
                      style={{ paddingRight: '32px' }} />
                    <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: 'var(--text-secondary)', pointerEvents: 'none' }}>V</span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>Triggers over-voltage alarm</div>
                </div>
              </div>
            </div>

            {/* Shore Power */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h3 style={{ marginTop: 0, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', margin: 0 }}>⚡ Shore Power</h3>
              <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.85rem' }}>Alert thresholds applied to shore power / AC inlet sensors.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px' }}>
                <div>
                  <label className="form-label">Critical Low</label>
                  <div style={{ position: 'relative' }}>
                    <input type="number" min="0" max="120" step="1" className="form-input"
                      value={shoreCritLowV}
                      onChange={(e) => setShoreCritLowV(Number(e.target.value))}
                      style={{ paddingRight: '32px' }} />
                    <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: 'var(--text-secondary)', pointerEvents: 'none' }}>V</span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>Triggers critical alarm</div>
                </div>
                <div>
                  <label className="form-label">Low Voltage</label>
                  <div style={{ position: 'relative' }}>
                    <input type="number" min="0" max="120" step="1" className="form-input"
                      value={shoreLowV}
                      onChange={(e) => setShoreLowV(Number(e.target.value))}
                      style={{ paddingRight: '32px' }} />
                    <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: 'var(--text-secondary)', pointerEvents: 'none' }}>V</span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>Triggers low-voltage warning</div>
                </div>
                <div>
                  <label className="form-label">Normal Voltage</label>
                  <div style={{ position: 'relative' }}>
                    <input type="number" min="90" max="160" step="1" className="form-input"
                      value={shoreNormalV}
                      onChange={(e) => setShoreNormalV(Number(e.target.value))}
                      style={{ paddingRight: '32px' }} />
                    <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: 'var(--text-secondary)', pointerEvents: 'none' }}>V</span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>Nominal line voltage</div>
                </div>
                <div>
                  <label className="form-label">High Voltage</label>
                  <div style={{ position: 'relative' }}>
                    <input type="number" min="110" max="160" step="1" className="form-input"
                      value={shoreHighV}
                      onChange={(e) => setShoreHighV(Number(e.target.value))}
                      style={{ paddingRight: '32px' }} />
                    <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: 'var(--text-secondary)', pointerEvents: 'none' }}>V</span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>Triggers high-voltage warning</div>
                </div>
                <div>
                  <label className="form-label">Critical High</label>
                  <div style={{ position: 'relative' }}>
                    <input type="number" min="110" max="160" step="1" className="form-input"
                      value={shoreCritHighV}
                      onChange={(e) => setShoreCritHighV(Number(e.target.value))}
                      style={{ paddingRight: '32px' }} />
                    <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: 'var(--text-secondary)', pointerEvents: 'none' }}>V</span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>Triggers critical alarm</div>
                </div>
              </div>
            </div>

          </div>
          )}
        </>
      )}

      {activeTab === 'friends' && (
        !user ? (
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', padding: '40px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: '3rem' }}>👥</div>
            <h3 style={{ margin: 0, color: 'var(--accent-cyan)' }}>Friends & Family Access</h3>
            <p style={{ color: 'var(--text-secondary)', maxWidth: '400px' }}>Sign in to share vehicle access with trusted friends or family.</p>
            {!showLogin ? (
              <button className="btn-primary" onClick={() => setShowLogin(true)}>Log into Boat-RV-Guardian.com</button>
            ) : (
              <div style={{ marginTop: '12px', width: '100%', background: 'rgba(0,0,0,0.2)', padding: '15px', borderRadius: '12px' }}>
                <Login />
                <button className="btn-secondary" onClick={() => setShowLogin(false)} style={{ fontSize: '0.85rem', marginTop: '10px' }}>Cancel</button>
              </div>
            )}
          </div>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {shareMsg && (
            <div style={{ fontSize: '0.85rem', padding: '10px', borderRadius: '8px',
              color: shareMsg.type === 'success' ? '#10b981' : '#ef4444',
              background: shareMsg.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)' }}>
              {shareMsg.text}
            </div>
          )}

          {/* Pending invitations addressed to me */}
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ margin: 0, color: 'var(--accent-cyan)' }}>Pending Invitations</h3>
            {pendingInvites.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>No pending invitations. When someone shares a vehicle with you, it appears here to accept.</p>
            ) : pendingInvites.map(inv => (
              <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.85rem' }}>
                  <strong>{inv.vehicleName}</strong> — {ROLE_LABELS[inv.role]}
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>from {inv.invitedByEmail}</div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn-primary" disabled={friendsBusy} onClick={() => handleAcceptInvite(inv)} style={{ padding: '6px 12px', fontSize: '0.8rem' }}>Accept</button>
                  <button className="btn-secondary" disabled={friendsBusy} onClick={() => handleDeclineInvite(inv)} style={{ padding: '6px 12px', fontSize: '0.8rem' }}>Decline</button>
                </div>
              </div>
            ))}
          </div>

          {/* Share a vehicle */}
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ margin: 0, color: 'var(--accent-cyan)' }}>Share <span style={{ color: 'var(--text-primary)' }}>{activeVehicleName}</span></h3>
            {!isActiveAdmin ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
                {activeCloudVehicle
                  ? 'Only an admin of the active vehicle can share it.'
                  : 'The active vehicle isn’t synced to the cloud yet. Sign in and sync it to share.'}
              </p>
            ) : (
              <>
                <div>
                  <label className="form-label">Friend's Email</label>
                  <input className="form-input" type="email" value={shareEmail} onChange={e => setShareEmail(e.target.value)} placeholder="friend@example.com" />
                </div>
                <div>
                  <label className="form-label">Privilege Level</label>
                  <select className="form-input" value={shareRole} onChange={e => setShareRole(e.target.value as VehicleRole)}>
                    {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '6px 0 0 0' }}>
                    {ROLE_OPTIONS.find(r => r.value === shareRole)?.desc}
                  </p>
                </div>
                <button className="btn-primary" disabled={friendsBusy || !shareEmail} onClick={handleCreateInvite}>
                  {friendsBusy ? 'Working…' : 'Create Invite'}
                </button>

                {lastInvite && (
                  <div style={{ background: 'rgba(0,242,254,0.06)', border: '1px solid rgba(0,242,254,0.3)', borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      Send this to <strong>{lastInvite.inviteeEmail}</strong> (no email is sent automatically):
                    </div>
                    {(() => {
                      const msg = `You've been invited to "${lastInvite.vehicleName}" on Boat & RV Guardian as "${ROLE_LABELS[lastInvite.role]}". To accept: 1) Install Boat & RV Guardian, 2) Sign in with ${lastInvite.inviteeEmail}, 3) open Settings → Friends and accept the pending invitation.`;
                      return (
                        <>
                          <textarea readOnly value={msg} rows={4} className="form-input" style={{ fontSize: '0.8rem', resize: 'vertical' }} />
                          <button className="btn-secondary" style={{ fontSize: '0.8rem' }}
                            onClick={() => { try { navigator.clipboard?.writeText(msg); setShareMsg({ text: 'Invitation message copied to clipboard.', type: 'success' }); } catch { /* ignore */ } }}>
                            📋 Copy invitation message
                          </button>
                        </>
                      );
                    })()}
                  </div>
                )}
              </>
            )}
          </div>

          {/* People with access to the ACTIVE vehicle */}
          {isActiveAdmin && (
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <h3 style={{ margin: 0, color: 'var(--accent-cyan)' }}>People With Access</h3>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{activeVehicleName}</div>
              {activeMembers.map(m => (
                <div key={m.uid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem' }}>
                  <span>{m.email} {m.uid === user.uid && <em style={{ color: 'var(--text-muted)' }}>(you)</em>} — {ROLE_LABELS[m.role]}</span>
                  {m.uid !== user.uid && (
                    <button className="btn-secondary" disabled={friendsBusy} onClick={() => handleRemoveMember(activeVid, m)} style={{ padding: '4px 10px', fontSize: '0.75rem', color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' }}>Revoke</button>
                  )}
                </div>
              ))}
              {(sentInvites[activeVid] || []).map(inv => (
                <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  <span>{inv.inviteeEmail} — {ROLE_LABELS[inv.role]} <em>(pending)</em></span>
                  <button className="btn-secondary" disabled={friendsBusy} onClick={() => handleCancelInvite(inv.id)} style={{ padding: '4px 10px', fontSize: '0.75rem' }}>Cancel</button>
                </div>
              ))}
            </div>
          )}

          {/* Vehicles shared with me — leave/remove connection */}
          {sharedWithMe.length > 0 && (
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <h3 style={{ margin: 0, color: 'var(--accent-cyan)' }}>Shared With Me</h3>
              {sharedWithMe.map(cv => (
                <div key={cv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem' }}>
                  <span><strong>{cv.lt_vessel_name || cv.id}</strong> — {ROLE_LABELS[getMyRole(cv) as VehicleRole]}</span>
                  <button className="btn-secondary" disabled={friendsBusy} onClick={() => handleLeaveVehicle(cv.id)} style={{ padding: '4px 10px', fontSize: '0.75rem', color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' }}>Leave</button>
                </div>
              ))}
            </div>
          )}
        </div>
        )
      )}

      {activeTab === 'updates' && (
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ margin: 0, color: 'var(--accent-cyan)' }}>Software Updates</h3>
          
          {latestVersion && latestVersion !== APP_VERSION ? (
            <div style={{ padding: '16px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid var(--accent-emerald)', borderRadius: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.2rem', marginBottom: '8px' }}>🎉 New Update Available!</div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Version <strong>{latestVersion}</strong> is ready to download.</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>You are currently running v{APP_VERSION}</div>
            </div>
          ) : (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '16px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
              Current Version: Boat &amp; RV Guardian v{APP_VERSION}
              {latestVersion === APP_VERSION && <div style={{ color: 'var(--accent-cyan)', marginTop: '8px' }}>You are up to date!</div>}
            </div>
          )}

          <a href="https://github.com/Boat-RV-Guardian/Boat-RV-Guardian/releases" target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            <button className="btn-secondary" style={{ width: '100%', padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '0.9rem', background: latestVersion && latestVersion !== APP_VERSION ? 'var(--accent-emerald)' : '', color: latestVersion && latestVersion !== APP_VERSION ? '#fff' : '', borderColor: latestVersion && latestVersion !== APP_VERSION ? 'var(--accent-emerald)' : '' }}>
              {latestVersion && latestVersion !== APP_VERSION ? '⬇️ Download Update' : '🔄 Check for Updates on GitHub'}
            </button>
          </a>
        </div>
      )}
      
      {/* Remove Device confirmation */}
      {deviceToRemove && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(5px)' }}>
          <div className="glass-card" style={{ maxWidth: '420px', width: '90%' }}>
            <h3 style={{ marginTop: 0, color: '#ef4444' }}>Remove Device</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Remove <strong>{deviceToRemove.name || deviceToRemove.role}</strong> from this vehicle? It will no longer be monitored in the app.
            </p>

            {deviceToRemove.type === 'shelly_sensor' && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '8px', padding: '12px', marginTop: '8px' }}>
                <input type="checkbox" checked={factoryResetOnRemove} onChange={(e) => setFactoryResetOnRemove(e.target.checked)} style={{ marginTop: '2px', accentColor: 'var(--accent-cyan)' }} />
                <span style={{ fontSize: '0.82rem' }}>
                  <strong>Also factory reset the device</strong> — erases its Wi-Fi credentials and settings so it can be set up fresh.
                  {!deviceToRemove.localIp && <span style={{ display: 'block', color: '#fde68a', marginTop: '4px' }}>⚠️ This device's local IP isn't known, so the reset signal can't be sent. It will only be removed from the app.</span>}
                  {deviceToRemove.localIp && <span style={{ display: 'block', color: 'var(--text-muted)', marginTop: '4px' }}>Requires being on the same Wi-Fi network as the device.</span>}
                </span>
              </label>
            )}

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button className="btn-secondary" onClick={() => { setDeviceToRemove(null); setFactoryResetOnRemove(false); }} style={{ flex: 1 }} disabled={removingDevice}>Cancel</button>
              <button className="btn-primary" onClick={confirmRemoveDevice} style={{ flex: 1, background: '#ef4444', borderColor: '#ef4444' }} disabled={removingDevice}>
                {removingDevice ? 'Removing…' : (factoryResetOnRemove && deviceToRemove.localIp ? 'Reset & Remove' : 'Remove')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Vehicle Modal */}
      {showNewVehicleModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(5px)'
        }}>
          <div className="glass-card" style={{ maxWidth: '400px', width: '90%' }}>
            <h3 style={{ marginTop: 0, color: 'var(--accent-cyan)' }}>Add New Vehicle</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              What would you like to call this new vehicle?
            </p>
            <input 
              type="text" 
              className="form-input" 
              placeholder="e.g. Tow Truck, Main Boat..." 
              value={newVehicleNameInput} 
              onChange={(e) => setNewVehicleNameInput(e.target.value)}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button className="btn-secondary" onClick={() => setShowNewVehicleModal(false)} style={{ flex: 1 }}>Cancel</button>
              <button className="btn-primary" onClick={confirmAddNewVehicle} style={{ flex: 1 }} disabled={!newVehicleNameInput.trim()}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Shelly Local Password change confirmation */}
      {showPwChangeModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(5px)'
        }}>
          <div className="glass-card" style={{ maxWidth: '440px', width: '90%' }}>
            <h3 style={{ marginTop: 0, color: '#f59e0b' }}>Change local password?</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Are you sure you want to change the local password? This pushes the new password to every
              Shelly device on this vehicle. <strong style={{ color: '#ffb3b3' }}>If it fails, a device can
              become unavailable and might need to be factory reset and re-paired.</strong>
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              <button className="btn-secondary" disabled={pwChangeBusy} onClick={() => setShowPwChangeModal(false)} style={{ flex: 1 }}>Cancel</button>
              <button className="btn-primary" disabled={pwChangeBusy} onClick={confirmChangeShellyPw}
                style={{ flex: 1, background: '#f59e0b', borderColor: '#f59e0b' }}>
                {pwChangeBusy ? 'Updating…' : 'Yes, change it'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Vehicle Modal */}
      {showDeleteModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(5px)'
        }}>
          <div className="glass-card" style={{ maxWidth: '400px', width: '90%' }}>
            <h3 style={{ marginTop: 0, color: '#ef4444' }}>Delete Vehicle</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Are you sure you want to delete <strong>{vesselNickname || 'this vehicle'}</strong>? This action cannot be undone.
            </p>
            
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', background: 'rgba(239, 68, 68, 0.1)', padding: '12px', borderRadius: '8px', cursor: 'pointer', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
              <input 
                type="checkbox" 
                checked={deleteConfirmChecked} 
                onChange={(e) => setDeleteConfirmChecked(e.target.checked)} 
                style={{ marginTop: '2px', width: '18px', height: '18px', accentColor: '#ef4444' }} 
              />
              <span style={{ fontSize: '0.85rem', color: '#ffb3b3' }}>
                I understand that all account information and device data for this vehicle will be permanently deleted.
              </span>
            </label>

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button className="btn-secondary" onClick={() => setShowDeleteModal(false)} style={{ flex: 1 }}>Cancel</button>
              <button 
                className="btn-primary" 
                onClick={handleDeleteVehicle} 
                style={{ flex: 1, background: '#ef4444', borderColor: '#ef4444' }} 
                disabled={!deleteConfirmChecked}
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
      
      {isProvisionModalOpen && <ProvisionShellyModal onClose={() => { setIsProvisionModalOpen(false); setDevices(getDevices()); }} />}
      {isProvisionLinkTapModalOpen && <ProvisionLinkTapModal onClose={() => { setIsProvisionLinkTapModalOpen(false); setDevices(getDevices()); }} />}
    </div>
  );
}
