import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AdvancedDeviceSettingsPanel from './AdvancedDeviceSettingsPanel';

// Component test locking the wiring this panel adds on top of the (separately-tested) battery preset
// table: battery thresholds round to 0.1 V and flip the chemistry to 'custom'; shore fields don't.

function renderPanel(over: Partial<React.ComponentProps<typeof AdvancedDeviceSettingsPanel>> = {}) {
  const props = {
    battType: 'flooded', battSystemV: '12',
    onApplyBatteryPreset: vi.fn(), onBattCustom: vi.fn(),
    battCritVoltage: 11.8, onBattCritChange: vi.fn(),
    battLowVoltage: 12.2, onBattLowChange: vi.fn(),
    battNormalVoltage: 12.6, onBattNormalChange: vi.fn(),
    battChargeVoltage: 13.6, onBattChargeChange: vi.fn(),
    battOverVoltage: 15.0, onBattOverChange: vi.fn(),
    shoreCritLowV: 104, onShoreCritLowChange: vi.fn(),
    shoreLowV: 114, onShoreLowChange: vi.fn(),
    shoreNormalV: 120, onShoreNormalChange: vi.fn(),
    shoreHighV: 126, onShoreHighChange: vi.fn(),
    shoreCritHighV: 132, onShoreCritHighChange: vi.fn(),
    ...over,
  };
  render(<AdvancedDeviceSettingsPanel {...props} />);
  return props;
}

describe('AdvancedDeviceSettingsPanel', () => {
  it('routes the battery-type dropdown to onApplyBatteryPreset with the current system voltage', () => {
    const p = renderPanel();
    const battTypeSelect = screen.getAllByRole('combobox')[0]; // Battery Type is the first select
    fireEvent.change(battTypeSelect, { target: { value: 'agm' } });
    expect(p.onApplyBatteryPreset).toHaveBeenCalledWith('agm', '12');
  });

  it('rounds a battery threshold to 0.1 V and flips the chemistry to custom', () => {
    const p = renderPanel();
    const critInput = screen.getAllByRole('spinbutton')[0]; // Critical Voltage is the first number field
    fireEvent.change(critInput, { target: { value: '11.84' } });
    expect(p.onBattCritChange).toHaveBeenCalledWith(11.8);
    expect(p.onBattCustom).toHaveBeenCalled();
  });

  it('does NOT flip the chemistry when a shore-power field is edited', () => {
    const p = renderPanel();
    const shoreCritLow = screen.getAllByRole('spinbutton')[5]; // 5 battery fields precede the shore grid
    fireEvent.change(shoreCritLow, { target: { value: '101' } });
    expect(p.onShoreCritLowChange).toHaveBeenCalledWith(101);
    expect(p.onBattCustom).not.toHaveBeenCalled();
  });
});
