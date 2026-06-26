import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NotificationsPanel from './NotificationsPanel';

function renderPanel(over: Partial<React.ComponentProps<typeof NotificationsPanel>> = {}) {
  const props = {
    notificationsEnabled: true, onNotificationsEnabledChange: vi.fn(),
    notifyAutoGuard: true, onNotifyAutoGuardChange: vi.fn(),
    alertOffline: true, onAlertOfflineChange: vi.fn(),
    notifyWatering: false, onNotifyWateringChange: vi.fn(),
    notifyFlood: true, onNotifyFloodChange: vi.fn(),
    notifyLowBattery: true, onNotifyLowBatteryChange: vi.fn(),
    notifyHouseBatt: true, onNotifyHouseBattChange: vi.fn(),
    notifyEngineBatt: true, onNotifyEngineBattChange: vi.fn(),
    notifyShorePower: true, onNotifyShorePowerChange: vi.fn(),
    alarmSound: 'siren' as const, onAlarmSoundChange: vi.fn(),
    alarmRepeatInterval: '30' as const, onAlarmRepeatIntervalChange: vi.fn(),
    alarmVolume: 1.0, onAlarmVolumeChange: vi.fn(),
    ...over,
  };
  render(<NotificationsPanel {...props} />);
  return props;
}

describe('NotificationsPanel', () => {
  it('reflects the master ENABLED/DISABLED state', () => {
    renderPanel({ notificationsEnabled: false });
    expect(screen.getByText('DISABLED')).toBeTruthy();
  });

  it('fires the master toggle callback', () => {
    const p = renderPanel();
    // The master enable checkbox is the first checkbox in the panel.
    const master = screen.getAllByRole('checkbox')[0];
    fireEvent.click(master);
    expect(p.onNotificationsEnabledChange).toHaveBeenCalledWith(false);
  });

  it('routes the alarm-sound select to its callback', () => {
    const p = renderPanel();
    const soundSelect = screen.getByDisplayValue(/Siren/i);
    fireEvent.change(soundSelect, { target: { value: 'off' } });
    expect(p.onAlarmSoundChange).toHaveBeenCalledWith('off');
  });
});
