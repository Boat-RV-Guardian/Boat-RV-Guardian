import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VehiclesPanel from './VehiclesPanel';
import { DEFAULT_WORKER_URL } from '../../utils/configSync';

// Component test for the "Use default hosted server" checkbox on the Cloud Alert Worker URL field
// (the rest of this large, mostly-plumbing panel isn't independently covered here).

function renderPanel(over: Partial<React.ComponentProps<typeof VehiclesPanel>> = {}) {
  const props = {
    selectedVid: 'v1', setSelectedVid: vi.fn(),
    vehiclesMap: { v1: { id: 'v1', config: { lt_vessel_name: 'Boat A' } } },
    activeVid: 'v1', onSwitchVehicle: vi.fn(), onAddNewVehicle: vi.fn(),
    isEditingName: false, setIsEditingName: vi.fn(),
    vesselNickname: 'Boat A', setVesselNickname: vi.fn(),
    vehicleType: 'boat' as const, onChangeVehicleType: vi.fn(),
    isEditingType: false, setIsEditingType: vi.fn(),
    showShellyPw: false, setShowShellyPw: vi.fn(),
    isEditingShellyPw: false, setIsEditingShellyPw: vi.fn(),
    shellyPwDraft: '', setShellyPwDraft: vi.fn(),
    shellyLocalPassword: 'pw123',
    pwChangeMsg: null, setPwChangeMsg: vi.fn(),
    onStartEditShellyPw: vi.fn(), onRequestSaveShellyPw: vi.fn(),
    showAdvanced: true, setShowAdvanced: vi.fn(),
    webhookUrl: '', setWebhookUrl: vi.fn(),
    webhookUser: '', setWebhookUser: vi.fn(),
    webhookKey: '', setWebhookKey: vi.fn(),
    showWebhookKey: false, setShowWebhookKey: vi.fn(),
    onManualSync: vi.fn(), user: null, isManualSyncing: false, manualSyncMsg: null,
    ...over,
  };
  render(<VehiclesPanel {...props} />);
  return props;
}

describe('VehiclesPanel — Cloud Alert Worker URL default checkbox', () => {
  it('defaults to "use default" (checked, disabled field showing the resolved default URL) when no custom URL is saved', () => {
    renderPanel({ webhookUrl: '' });
    const checkbox = screen.getByRole('checkbox', { name: /use default hosted server/i });
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    const urlField = screen.getByPlaceholderText(/your-server\.example\.com/i) as HTMLInputElement;
    expect(urlField.value).toBe(DEFAULT_WORKER_URL);
    expect(urlField.disabled).toBe(true);
  });

  it('starts in custom mode (unchecked, editable) when a non-default URL is already saved', () => {
    renderPanel({ webhookUrl: 'https://my-self-host.example.com' });
    const checkbox = screen.getByRole('checkbox', { name: /use default hosted server/i });
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    const urlField = screen.getByPlaceholderText(/your-server\.example\.com/i) as HTMLInputElement;
    expect(urlField.value).toBe('https://my-self-host.example.com');
    expect(urlField.disabled).toBe(false);
  });

  it('unchecking "use default" enables the field for a custom URL', () => {
    const p = renderPanel({ webhookUrl: '' });
    const checkbox = screen.getByRole('checkbox', { name: /use default hosted server/i });
    fireEvent.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    const urlField = screen.getByPlaceholderText(/your-server\.example\.com/i) as HTMLInputElement;
    expect(urlField.disabled).toBe(false);
    fireEvent.change(urlField, { target: { value: 'https://my-server.example.com' } });
    expect(p.setWebhookUrl).toHaveBeenCalledWith('https://my-server.example.com');
  });

  it('re-checking "use default" clears the stored URL (so it keeps following DEFAULT_WORKER_URL, not a frozen value)', () => {
    const p = renderPanel({ webhookUrl: 'https://my-self-host.example.com' });
    const checkbox = screen.getByRole('checkbox', { name: /use default hosted server/i });
    fireEvent.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    expect(p.setWebhookUrl).toHaveBeenCalledWith('');
  });
});
