import { VEHICLE_KEYS, VEHICLE_DEFAULT_CONFIG } from './configSync';

export interface DeviceConfig {
  id: string; // Internal BoatRV Device ID (e.g., 'brv_dev_123')
  type: 'linktap_valve' | 'shelly_sensor';
  role: string; // e.g., 'Fresh Water', 'High Power'
  name: string;
  
  // LinkTap mapping
  linktapGatewayId?: string;
  linktapDeviceId?: string;
  
  // Shelly mapping
  shellyDeviceId?: string;
  localIp?: string; // Shelly local IP (for local RPC polling / factory reset)
  mdnsHost?: string; // Shelly mDNS .local hostname — survives DHCP IP churn; preferred over localIp
  webhookAppIp?: string; // app LAN IP last registered in this device's local webhook (self-heal marker)
  webhookCloudBase?: string; // worker base URL last registered in this device's cloud webhook (self-heal / cutover marker)
  batteryPowered?: boolean; // sleepy sensor (flood etc.) — don't poll; rely on webhook push
  bleMac?: string; // BLE address recorded during BLE pairing/onboarding
  fwVersion?: string;        // current firmware version (from Shelly.GetDeviceInfo at onboarding)
  fwUpdateVersion?: string;  // available stable update version, if any (presence ⇒ update available)

  // Per-device voltage calibration offset (V) for the Shelly Plus Uni voltmeter. The correction is
  // written ONTO the device (Voltmeter.SetConfig xvoltage = "x + offset"), so the local poll AND the
  // Shelly cloud both report the corrected value (read as voltmeter:N.xvoltage). This field just
  // mirrors the last-applied offset for the settings UI; the device is the source of truth.
  voltCalOffset?: number;

  // Device-specific settings
  maxDuration?: number;
  autoGuardEnabled?: boolean;

  // Whether the device is active. undefined === enabled (default on, backward-compatible).
  // Disabled devices are not polled and are skipped by startup auto-connect.
  enabled?: boolean;
}

export interface Vehicle {
  id: string;
  config: Record<string, string>;
}

export function generateVehicleId() {
  return 'v_' + Math.random().toString(36).substr(2, 9);
}

// 8-char password with upper, lower, and digits — used as each vehicle's Shelly local password.
export function generateShellyPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];
  // Guarantee at least one of each class, then fill the rest.
  let chars = [pick(upper), pick(upper), pick(lower), pick(lower), pick(lower), pick(digits), pick(digits), pick(all)];
  // Shuffle so the guaranteed positions aren't predictable.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// Dispatch settings_updated with the cloud-sync guard raised so SyncModal's auto-save does
// NOT treat a vehicle change as an edit and write the freshly-loaded config to the wrong record.
function dispatchSettingsUpdatedGuarded() {
  (window as any).__is_syncing_cloud = true;
  window.dispatchEvent(new Event('settings_updated'));
  (window as any).__is_syncing_cloud = false;
}

// Vehicles CREATED in this app session (in-memory; cleared on reload). A vehicle here is "new and
// possibly not yet pushed to the cloud", so SyncModal must (a) still push it even though its cloud doc
// doesn't exist yet, and (b) NOT prune it from the local list before the push lands. A STALE local
// vehicle from a prior session whose cloud doc is gone (deleted by an admin or another device) is NOT
// in this set, so it is neither resurrected nor protected — fixing the "deleted vehicle came back on
// login" bug. The set resets on reload, which is correct: after a reload nothing is mid-creation.
const sessionCreatedIds = new Set<string>();
export function markSessionCreated(id: string) { sessionCreatedIds.add(id); }
export function wasCreatedThisSession(id: string): boolean { return sessionCreatedIds.has(id); }
export function getSessionCreatedIds(): Set<string> { return new Set(sessionCreatedIds); }

// Tombstones: ids deleted locally. Filtered out of cloud re-hydration so a deleted vehicle
// cannot reappear in the window before the cloud allowedUsers removal propagates.
export function getDeletedVehicleIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem('lt_deleted_vehicles') || '[]');
  } catch {
    return [];
  }
}

function addDeletedVehicleId(id: string) {
  const ids = getDeletedVehicleIds();
  if (!ids.includes(id)) {
    ids.push(id);
    localStorage.setItem('lt_deleted_vehicles', JSON.stringify(ids));
  }
}

export function getVehiclesMap(): Record<string, Vehicle> {
  try {
    const data = localStorage.getItem('lt_vehicles');
    return data ? JSON.parse(data) : {};
  } catch (e) {
    return {};
  }
}

export function saveVehiclesMap(map: Record<string, Vehicle>) {
  localStorage.setItem('lt_vehicles', JSON.stringify(map));
}

// Returns the active vehicle id, or '' if none exists. Does NOT auto-create — onboarding
// (App.tsx) requires the user to log in or explicitly create a local vehicle first.
export function getActiveVehicleId(): string {
  return localStorage.getItem('lt_active_vehicle_id') || '';
}

export function hasActiveVehicle(): boolean {
  const id = getActiveVehicleId();
  return !!id && !!getVehiclesMap()[id];
}

// Explicitly create the first/local vehicle (used by the onboarding "Create a local vehicle"
// action), seeding from any existing root keys, then make it active.
export function createLocalVehicle(name: string = 'My First Vehicle', type: '' | 'boat' | 'rv' = ''): string {
  const map = getVehiclesMap();
  const id = generateVehicleId();
  const config: Record<string, string> = {};
  for (const key of VEHICLE_KEYS) {
    config[key] = localStorage.getItem(key) || VEHICLE_DEFAULT_CONFIG[key];
  }
  config.lt_vessel_name = name;
  localStorage.setItem('lt_vessel_name', name);
  config.lt_vehicle_type = type;
  localStorage.setItem('lt_vehicle_type', type);
  if (!config.sh_local_password) {
    config.sh_local_password = generateShellyPassword();
    localStorage.setItem('sh_local_password', config.sh_local_password);
  }
  map[id] = { id, config };
  saveVehiclesMap(map);
  localStorage.setItem('lt_active_vehicle_id', id);
  markSessionCreated(id); // new this session → SyncModal pushes it + prune protects it until pushed
  dispatchSettingsUpdatedGuarded();
  return id;
}

/**
 * Saves the current active configuration from root localStorage into the active vehicle profile.
 */
export function syncRootToActiveVehicle() {
  const activeId = getActiveVehicleId();
  if (!activeId) return; // nothing active yet (onboarding) — nothing to back up
  const map = getVehiclesMap();

  if (!map[activeId]) {
    map[activeId] = { id: activeId, config: {} };
  }

  for (const key of VEHICLE_KEYS) {
    map[activeId].config[key] = localStorage.getItem(key) || VEHICLE_DEFAULT_CONFIG[key];
  }
  
  saveVehiclesMap(map);
}

/**
 * Switches the active vehicle, saving current state and loading the new vehicle state into root localStorage.
 */
export function switchVehicle(newId: string) {
  const map = getVehiclesMap();
  if (!map[newId]) throw new Error('Vehicle not found');

  // Backup current state
  syncRootToActiveVehicle();

  // Load new state
  const newConfig = map[newId].config;
  for (const key of VEHICLE_KEYS) {
    localStorage.setItem(key, newConfig[key] || VEHICLE_DEFAULT_CONFIG[key]);
  }

  localStorage.setItem('lt_active_vehicle_id', newId);
  dispatchSettingsUpdatedGuarded();
}

export function addNewVehicle(name: string = 'New Vehicle', type: '' | 'boat' | 'rv' = '') {
  const map = getVehiclesMap();
  const id = generateVehicleId();
  const newConfig = { ...VEHICLE_DEFAULT_CONFIG, lt_vessel_name: name, lt_vehicle_type: type, sh_local_password: generateShellyPassword() };
  map[id] = { id, config: newConfig };
  saveVehiclesMap(map);
  markSessionCreated(id); // new this session → SyncModal pushes it + prune protects it until pushed
  return id;
}

export function deleteVehicle(id: string) {
  const map = getVehiclesMap();
  if (Object.keys(map).length <= 1) {
    throw new Error('Cannot delete the last vehicle.');
  }

  delete map[id];
  saveVehiclesMap(map);
  addDeletedVehicleId(id); // tombstone so the cloud listener can't re-add it

  const activeId = localStorage.getItem('lt_active_vehicle_id');
  if (activeId === id) {
    // We deleted the active vehicle, switch to the first available one
    const newActiveId = Object.keys(map)[0];
    const newConfig = map[newActiveId].config;
    for (const key of VEHICLE_KEYS) {
      localStorage.setItem(key, newConfig[key] || VEHICLE_DEFAULT_CONFIG[key]);
    }
    localStorage.setItem('lt_active_vehicle_id', newActiveId);
    dispatchSettingsUpdatedGuarded();
  }
}

// --- Device Array Management Helpers ---

export function getDevices(): DeviceConfig[] {
  try {
    const data = localStorage.getItem('lt_devices');
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function saveDevices(devices: DeviceConfig[]) {
  localStorage.setItem('lt_devices', JSON.stringify(devices));
  window.dispatchEvent(new Event('settings_updated'));
}

export function addDevice(device: DeviceConfig) {
  const devices = getDevices();
  devices.push(device);
  saveDevices(devices);
}

export function updateDevice(id: string, updates: Partial<DeviceConfig>) {
  const devices = getDevices();
  const index = devices.findIndex(d => d.id === id);
  if (index !== -1) {
    devices[index] = { ...devices[index], ...updates };
    saveDevices(devices);
  }
}

export function removeDevice(id: string) {
  const devices = getDevices();
  const newDevices = devices.filter(d => d.id !== id);
  saveDevices(newDevices);
}
