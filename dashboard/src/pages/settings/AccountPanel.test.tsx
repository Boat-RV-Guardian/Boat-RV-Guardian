import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AccountPanel from './AccountPanel';

function renderPanel(over: Partial<React.ComponentProps<typeof AccountPanel>> = {}) {
  const props = {
    user: { uid: 'u1', email: 'me@example.com' },
    localMode: false,
    showLogin: false, setShowLogin: vi.fn(),
    syncSettingsCloud: true, setSyncSettingsCloud: vi.fn(),
    canCloudHistory: true,
    storeHistoryCloud: false, setStoreHistoryCloud: vi.fn(),
    vehiclesMap: {},
    userConfig: null,
    updateUserConfig: vi.fn(),
    defaultVidSaving: false, setDefaultVidSaving: vi.fn(),
    ...over,
  };
  render(<AccountPanel {...props} />);
  return props;
}

describe('AccountPanel', () => {
  it('shows the sign-in CTA when signed out', () => {
    renderPanel({ user: null });
    expect(screen.getByRole('button', { name: /log into/i })).toBeTruthy();
  });

  it('shows the local-only switch-to-cloud CTA + discard warning in local mode', () => {
    renderPanel({ user: null, localMode: true, vehiclesMap: { v1: {} as any, v2: {} as any } });
    expect(screen.getByText(/local-only mode/i)).toBeTruthy();
    expect(screen.getByText(/2 vehicles stored only on this device/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /switch to a cloud account/i })).toBeTruthy();
  });

  it('reveals the inline Login when the local user starts the cloud switch', () => {
    const p = renderPanel({ user: null, localMode: true });
    fireEvent.click(screen.getByRole('button', { name: /switch to a cloud account/i }));
    expect(p.setShowLogin).toHaveBeenCalledWith(true);
  });

  it('shows the account email + sign-out when signed in', () => {
    renderPanel();
    expect(screen.getByText(/me@example\.com/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeTruthy();
  });

  it('disables the cloud-history toggle for tiers with no retention', () => {
    renderPanel({ canCloudHistory: false });
    const storeHistory = screen.getAllByRole('checkbox')[1]; // 2nd toggle = store historical data
    expect((storeHistory as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/upgrade to enable/i)).toBeTruthy();
  });

  it('enables + wires the cloud-history toggle when the tier allows retention', () => {
    const p = renderPanel({ canCloudHistory: true });
    const storeHistory = screen.getAllByRole('checkbox')[1];
    expect((storeHistory as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(storeHistory);
    expect(p.setStoreHistoryCloud).toHaveBeenCalledWith(true);
  });
});
