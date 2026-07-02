import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AddDevicePanel from './AddDevicePanel';

describe('AddDevicePanel device-limit gating', () => {
  it('shows the usage count and lets you add below the limit', () => {
    const onAddLinkTap = vi.fn();
    const onAddShelly = vi.fn();
    render(<AddDevicePanel deviceCount={2} maxDevices={3} onAddLinkTap={onAddLinkTap} onAddShelly={onAddShelly} />);

    expect(screen.getByText(/2 of 3 devices used/i)).toBeTruthy();
    const linktap = screen.getByRole('button', { name: /LinkTap Valve/i });
    expect((linktap as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(linktap);
    expect(onAddLinkTap).toHaveBeenCalledOnce();
  });

  it('disables both add buttons and prompts to upgrade at the limit', () => {
    const onAddLinkTap = vi.fn();
    const onAddShelly = vi.fn();
    render(<AddDevicePanel deviceCount={3} maxDevices={3} onAddLinkTap={onAddLinkTap} onAddShelly={onAddShelly} />);

    expect(screen.getByText(/upgrade your plan to add more/i)).toBeTruthy();
    const linktap = screen.getByRole('button', { name: /LinkTap Valve/i }) as HTMLButtonElement;
    const shelly = screen.getByRole('button', { name: /Shelly Sensor/i }) as HTMLButtonElement;
    expect(linktap.disabled).toBe(true);
    expect(shelly.disabled).toBe(true);
    fireEvent.click(linktap);
    fireEvent.click(shelly);
    expect(onAddLinkTap).not.toHaveBeenCalled();
    expect(onAddShelly).not.toHaveBeenCalled();
  });
});
