import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VehicleWifiPanel from './VehicleWifiPanel';
import { saveVehicleWifi, loadVehicleWifi } from '../../utils/vehicleWifi';

const VID = 'v1';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('lt_active_vehicle_id', VID);
});

describe('VehicleWifiPanel', () => {
  it('offers to save a network when none is stored', () => {
    render(<VehicleWifiPanel />);
    expect(screen.getByText(/no network saved/i)).toBeTruthy();
  });

  it('saves a network and shows it masked until revealed', () => {
    render(<VehicleWifiPanel />);
    fireEvent.click(screen.getByRole('button', { name: /save a network/i }));
    fireEvent.change(screen.getByPlaceholderText(/BoatNetwork/i), { target: { value: 'BoatNet' } });
    const pw = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(pw, { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(loadVehicleWifi(VID)).toMatchObject({ ssid: 'BoatNet', password: 'hunter2' });
    expect(screen.getByText(/📶 BoatNet/)).toBeTruthy();
    expect(screen.queryByText('hunter2')).toBeNull(); // masked by default

    fireEvent.click(screen.getByRole('button', { name: /reveal/i }));
    expect(screen.getByText(/hunter2/)).toBeTruthy();
  });

  it('forgets a saved network', () => {
    saveVehicleWifi(VID, 'BoatNet', 'pw');
    render(<VehicleWifiPanel />);
    fireEvent.click(screen.getByRole('button', { name: /forget/i }));
    expect(loadVehicleWifi(VID)).toBeNull();
    expect(screen.getByText(/no network saved/i)).toBeTruthy();
  });

  // The security-relevant behaviour: a view-only member is never shown the network password.
  it('denies a monitor entirely, even when credentials exist on this device', () => {
    saveVehicleWifi(VID, 'BoatNet', 'hunter2');
    localStorage.setItem('lt_my_role', 'monitor');
    render(<VehicleWifiPanel />);
    expect(screen.getByText(/only an admin or a monitor-and-control member/i)).toBeTruthy();
    expect(screen.queryByText(/📶 BoatNet/)).toBeNull();
    expect(screen.queryByRole('button', { name: /reveal/i })).toBeNull();
  });

  it('allows a control member', () => {
    saveVehicleWifi(VID, 'BoatNet', 'pw');
    localStorage.setItem('lt_my_role', 'control');
    render(<VehicleWifiPanel />);
    expect(screen.getByText(/📶 BoatNet/)).toBeTruthy();
  });
});
