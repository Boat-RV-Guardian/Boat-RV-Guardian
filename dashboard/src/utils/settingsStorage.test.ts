import { describe, it, expect, beforeEach } from 'vitest';
import { readSettings, writeSettings, buildLocalDevices, applyPersistedSettings, type PersistedSettings, type SettingsSetters } from './settingsStorage';

// Build a SettingsSetters whose every setter records the value it was called with into `received`,
// so a test can assert what applyPersistedSettings fanned out. Keys are derived from a settings
// object so the map can't silently miss a field.
function recordingSetters(template: PersistedSettings) {
  const received: Partial<PersistedSettings> = {};
  const setters = {} as SettingsSetters;
  for (const key of Object.keys(template) as (keyof PersistedSettings)[]) {
    (setters as any)[key] = (value: unknown) => { (received as any)[key] = value; };
  }
  return { received, setters };
}

// A fully-specified value set distinct from the defaults, with already-trimmed webhook fields so the
// round-trip is exact (writeSettings trims those).
const SAMPLE: PersistedSettings = {
  syncSettingsCloud: false,
  storeHistoryCloud: true,
  vesselNickname: 'My Boat',
  shellyLocalPassword: 'secret',
  webhookUrl: 'https://example.com',
  webhookUser: 'user',
  webhookKey: 'key',
  localServerEnabled: true,
  localServerBackground: true,
  unitSystem: 'metric',
  timeZone: 'America/New_York',
  normalRunHours: 3,
  normalRunMinutes: 15,
  normalRunDaily: true,
  normalRunVolume: 42,
  autoRestartNormal: true,
  isCloudPollingActive: true,
  isLocalPollingActive: true,
  cloudUsername: 'clouduser',
  cloudApiKey: 'cloudkey',
  gatewayIp: '192.168.1.50',
  gatewayId: 'GW1234',
  primaryDeviceId: 'DEV1',
  secondaryDeviceId: 'DEV2',
  shellyServer: 'shelly-2-eu.shelly.cloud',
  shellyAuthKey: 'authkey',
  highPowerIds: ['a', 'b', '', ''],
  lowPowerIds: ['c', '', '', ''],
  floodSensorIds: ['d', 'e', 'f', ''],
  notificationsEnabled: false,
  notifyAutoGuard: false,
  alertOffline: false,
  notifyLowBattery: false,
  notifyWatering: true,
  notifyFlood: false,
  notifyHouseBatt: false,
  notifyEngineBatt: false,
  notifyShorePower: false,
  alarmSound: 'beep',
  alarmVolume: 0.5,
  alarmRepeatInterval: '15',
  maxDuration: 45,
  autoGuardEnabled: false,
  battType: 'lifepo4',
  battSystemV: '24',
  battLowVoltage: 25.6,
  battCritVoltage: 24,
  battNormalVoltage: 26.4,
  battOverVoltage: 29.2,
  battChargeVoltage: 27.6,
  shoreCritLowV: 100,
  shoreLowV: 110,
  shoreNormalV: 120,
  shoreHighV: 130,
  shoreCritHighV: 140,
};

describe('settingsStorage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips every field through write → read', () => {
    writeSettings(SAMPLE);
    expect(readSettings()).toEqual(SAMPLE);
  });

  it('reads documented defaults from empty storage', () => {
    const s = readSettings();
    expect(s.syncSettingsCloud).toBe(true);       // absent !== 'false'
    expect(s.storeHistoryCloud).toBe(false);
    expect(s.unitSystem).toBe('imperial');
    expect(s.localServerEnabled).toBe(false);      // off-by-default (Task 5)
    expect(s.shellyServer).toBe('shelly-1-eu.shelly.cloud');
    expect(s.alarmSound).toBe('siren');
    expect(s.alarmRepeatInterval).toBe('30');
    expect(s.battType).toBe('flooded');
    expect(s.battSystemV).toBe('12');
    expect(s.maxDuration).toBe(30);
    expect(s.shoreNormalV).toBe(120);
    // the four notification toggles that the rehydrate effect omits still default ON when read
    expect(s.notifyFlood).toBe(true);
    expect(s.notifyHouseBatt).toBe(true);
    expect(s.notifyEngineBatt).toBe(true);
    expect(s.notifyShorePower).toBe(true);
  });

  it('trims webhook fields on write', () => {
    writeSettings({ ...SAMPLE, webhookUrl: '  https://x.test  ', webhookUser: ' u ', webhookKey: ' k ' });
    expect(localStorage.getItem('sh_webhook_url')).toBe('https://x.test');
    expect(localStorage.getItem('sh_webhook_user')).toBe('u');
    expect(localStorage.getItem('sh_webhook_key')).toBe('k');
  });

  it('falls back to four empty slots when a device-id array is corrupt', () => {
    localStorage.setItem('sh_high_power', 'not json');
    expect(readSettings().highPowerIds).toEqual(['', '', '', '']);
  });

  describe('buildLocalDevices (lt_local_devices for the Add-Valve modal)', () => {
    it('mirrors the local gateway + both TapLinker IDs into the modal shape on write', () => {
      writeSettings(SAMPLE); // gatewayId GW1234, primary DEV1, secondary DEV2
      expect(JSON.parse(localStorage.getItem('lt_local_devices') || '[]')).toEqual([
        { deviceId: 'DEV1', name: 'Local TapLinker 1', gatewayId: 'GW1234' },
        { deviceId: 'DEV2', name: 'Local TapLinker 2', gatewayId: 'GW1234' },
      ]);
    });

    it('emits nothing without a Gateway ID (a device id alone cannot be actuated locally)', () => {
      expect(buildLocalDevices({ ...SAMPLE, gatewayId: '   ' })).toEqual([]);
    });

    it('emits only the primary when the secondary is blank', () => {
      expect(buildLocalDevices({ ...SAMPLE, secondaryDeviceId: '' })).toEqual([
        { deviceId: 'DEV1', name: 'Local TapLinker 1', gatewayId: 'GW1234' },
      ]);
    });

    it('de-dupes a secondary that repeats the primary', () => {
      expect(buildLocalDevices({ ...SAMPLE, secondaryDeviceId: 'DEV1' })).toEqual([
        { deviceId: 'DEV1', name: 'Local TapLinker 1', gatewayId: 'GW1234' },
      ]);
    });

    it('emits an empty list when the gateway has no configured TapLinker', () => {
      expect(buildLocalDevices({ ...SAMPLE, primaryDeviceId: '', secondaryDeviceId: '' })).toEqual([]);
    });
  });

  describe('applyPersistedSettings', () => {
    it('applies every persisted field to its setter (no field dropped)', () => {
      const { received, setters } = recordingSetters(SAMPLE);
      applyPersistedSettings(SAMPLE, setters);
      // Every field round-trips through its setter exactly — the structural guard against the
      // rehydrate-drift bug that silently skipped fields.
      expect(received).toEqual(SAMPLE);
    });

    it('rehydrates the flood/house/engine/shore notification toggles (regression)', () => {
      // These four were persisted by writeSettings but omitted from the old hand-maintained
      // rehydrate list, so a background settings_updated left them stale. Assert they now flow.
      const { received, setters } = recordingSetters(SAMPLE);
      const toggled: PersistedSettings = {
        ...SAMPLE,
        notifyFlood: false,
        notifyHouseBatt: false,
        notifyEngineBatt: false,
        notifyShorePower: false,
      };
      applyPersistedSettings(toggled, setters);
      expect(received.notifyFlood).toBe(false);
      expect(received.notifyHouseBatt).toBe(false);
      expect(received.notifyEngineBatt).toBe(false);
      expect(received.notifyShorePower).toBe(false);
    });
  });
});
