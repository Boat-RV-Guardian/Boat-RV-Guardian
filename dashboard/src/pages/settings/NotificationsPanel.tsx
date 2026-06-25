// Notifications & Alarms panel (Settings → General, inside Device Preferences). Extracted from
// Settings.tsx as part of the Task 3 split. Pure presentational: state + persistence stay in
// Settings; this takes value/onChange pairs (same pattern as LocalServerPanel).

export type AlarmSound = 'siren' | 'beep' | 'off';
export type AlarmRepeat = 'once' | '5' | '15' | '30' | '60';

interface Props {
  notificationsEnabled: boolean;
  onNotificationsEnabledChange: (v: boolean) => void;
  notifyAutoGuard: boolean;
  onNotifyAutoGuardChange: (v: boolean) => void;
  alertOffline: boolean;
  onAlertOfflineChange: (v: boolean) => void;
  notifyWatering: boolean;
  onNotifyWateringChange: (v: boolean) => void;
  notifyFlood: boolean;
  onNotifyFloodChange: (v: boolean) => void;
  notifyLowBattery: boolean;
  onNotifyLowBatteryChange: (v: boolean) => void;
  notifyHouseBatt: boolean;
  onNotifyHouseBattChange: (v: boolean) => void;
  notifyEngineBatt: boolean;
  onNotifyEngineBattChange: (v: boolean) => void;
  notifyShorePower: boolean;
  onNotifyShorePowerChange: (v: boolean) => void;
  alarmSound: AlarmSound;
  onAlarmSoundChange: (v: AlarmSound) => void;
  alarmRepeatInterval: AlarmRepeat;
  onAlarmRepeatIntervalChange: (v: AlarmRepeat) => void;
  alarmVolume: number;
  onAlarmVolumeChange: (v: number) => void;
}

export default function NotificationsPanel({
  notificationsEnabled, onNotificationsEnabledChange,
  notifyAutoGuard, onNotifyAutoGuardChange,
  alertOffline, onAlertOfflineChange,
  notifyWatering, onNotifyWateringChange,
  notifyFlood, onNotifyFloodChange,
  notifyLowBattery, onNotifyLowBatteryChange,
  notifyHouseBatt, onNotifyHouseBattChange,
  notifyEngineBatt, onNotifyEngineBattChange,
  notifyShorePower, onNotifyShorePowerChange,
  alarmSound, onAlarmSoundChange,
  alarmRepeatInterval, onAlarmRepeatIntervalChange,
  alarmVolume, onAlarmVolumeChange,
}: Props) {
  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '16px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>Notifications & Alarms</h3>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '0.85rem', color: notificationsEnabled ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>{notificationsEnabled ? 'ENABLED' : 'DISABLED'}</span>
        <input type="checkbox" checked={notificationsEnabled} onChange={(e) => onNotificationsEnabledChange(e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--accent-cyan)' }} />
      </div>
    </div>

    <h4 style={{ margin: '8px 0 0', fontSize: '1rem', color: 'var(--text-secondary)' }}>Fresh Water</h4>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px' }}>
       <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
         <input type="checkbox" checked={notifyAutoGuard} onChange={(e) => onNotifyAutoGuardChange(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-cyan)' }} />
         <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Auto-Guard Triggers</span>
       </label>
       <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
         <input type="checkbox" checked={alertOffline} onChange={(e) => onAlertOfflineChange(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-orange)' }} />
         <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Device Offline</span>
       </label>
       <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
         <input type="checkbox" checked={notifyWatering} onChange={(e) => onNotifyWateringChange(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: 'var(--text-secondary)' }} />
         <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Water Start/Stop</span>
       </label>
    </div>

    <h4 style={{ margin: '8px 0 0', fontSize: '1rem', color: 'var(--text-secondary)' }}>High Water/Flood</h4>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px' }}>
       <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
         <input type="checkbox" checked={notifyFlood} onChange={(e) => onNotifyFloodChange(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-cyan)' }} />
         <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Bilge/Flood Sensor Triggered</span>
       </label>
    </div>

    <h4 style={{ margin: '8px 0 0', fontSize: '1rem', color: 'var(--text-secondary)' }}>Batteries</h4>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px' }}>
       <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
         <input type="checkbox" checked={notifyLowBattery} onChange={(e) => onNotifyLowBatteryChange(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-orange)' }} />
         <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Fresh Water Valve Low Battery</span>
       </label>
       <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
         <input type="checkbox" checked={notifyHouseBatt} onChange={(e) => onNotifyHouseBattChange(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-orange)' }} />
         <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>House Battery Low (&lt;12.0V)</span>
       </label>
       <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
         <input type="checkbox" checked={notifyEngineBatt} onChange={(e) => onNotifyEngineBattChange(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-orange)' }} />
         <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Engine Battery Low (&lt;12.0V)</span>
       </label>
    </div>

    <h4 style={{ margin: '8px 0 0', fontSize: '1rem', color: 'var(--text-secondary)' }}>Shore Power</h4>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px' }}>
       <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
         <input type="checkbox" checked={notifyShorePower} onChange={(e) => onNotifyShorePowerChange(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-orange)' }} />
         <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Shore Power Disconnected</span>
       </label>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
      <div>
        <label className="form-label">Warning Alarm Sound</label>
        <select className="form-input" value={alarmSound} onChange={(e) => onAlarmSoundChange(e.target.value as AlarmSound)}>
          <option value="siren">🚨 Siren (Loud)</option>
          <option value="beep">⚠️ Beep (Standard)</option>
          <option value="off">🔇 Silent</option>
        </select>
      </div>
      <div>
        <label className="form-label">Alarm Repeat</label>
        <select className="form-input" value={alarmRepeatInterval} onChange={(e) => onAlarmRepeatIntervalChange(e.target.value as AlarmRepeat)}>
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
      <input type="range" min="0.1" max="1.0" step="0.1" className="form-input" style={{ padding: 0 }} value={alarmVolume} onChange={(e) => onAlarmVolumeChange(Number(e.target.value))} />
    </div>
    </div>
  );
}
