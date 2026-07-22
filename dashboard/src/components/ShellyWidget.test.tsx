import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Stub firebase so importing the widget (which subscribes to sensorState) needs no backend.
vi.mock('../services/firebase', () => ({
  db: {},
  doc: vi.fn(() => ({})),
  onSnapshot: vi.fn(() => () => {}),
}));

(globalThis as any).__DEMO__ = false;

import ShellyWidget, { mapCloudSensorDoc } from './ShellyWidget';

beforeEach(() => localStorage.clear());

describe('mapCloudSensorDoc', () => {
  it('maps voltage by role (shore → pm1:0, DC → voltmeter:100)', () => {
    expect(mapCloudSensorDoc('High Power Sensor', { v: 118 })['pm1:0']).toEqual({ voltage: 118 });
    const dc = mapCloudSensorDoc('Low Power Sensor', { v: 12.6, vraw: 12.3 });
    expect(dc['voltmeter:100']).toEqual({ id: 100, voltage: 12.3, xvoltage: 12.6 });
  });

  it('maps environmental temp + humidity + battery', () => {
    const r = mapCloudSensorDoc('Environmental Sensor', { tC: 21.5, rh: 63, batt: 88 });
    expect(r['temperature:0']).toEqual({ tC: 21.5 });
    expect(r['humidity:0']).toEqual({ rh: 63 });
    expect(r['devicepower:0']).toEqual({ battery: { percent: 88 } });
  });

  it('maps flood events to the alarm flag', () => {
    expect(mapCloudSensorDoc('Flood Sensor', { event: 'flood.alarm' })['flood:0']).toEqual({ alarm: true });
    expect(mapCloudSensorDoc('Flood Sensor', { event: 'flood.alarm_off' })['flood:0']).toEqual({ alarm: false });
  });
});

describe('ShellyWidget — Environmental Sensor', () => {
  it('renders as a battery (sleepy) sensor without polling errors when no data yet', () => {
    render(<ShellyWidget device={{
      id: 'd1', type: 'shelly_sensor', role: 'Environmental Sensor',
      name: 'Cabin Climate', shellyDeviceId: 'shellyhtg3-aabbcc',
    } as any} />);
    expect(screen.getByText('Cabin Climate')).toBeTruthy();
    expect(screen.getByText(/BATTERY/)).toBeTruthy(); // treated as sleepy — never "unreachable"
  });
});
