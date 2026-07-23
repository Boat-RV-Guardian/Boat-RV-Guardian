import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import AccountPanel from './AccountPanel';
import { readPendingMigration, stashPendingMigration, PENDING_MIGRATION_KEY } from '../../utils/migrateLocalToCloud';

function renderPanel(over: Partial<React.ComponentProps<typeof AccountPanel>> = {}) {
  const props = {
    user: { uid: 'u1', email: 'me@example.com' },
    localMode: false,
    showLogin: false, setShowLogin: vi.fn(),
    vehiclesMap: {},
    userConfig: null,
    updateUserConfig: vi.fn(),
    defaultVidSaving: false, setDefaultVidSaving: vi.fn(),
    ...over,
  };
  render(<AccountPanel {...props} />);
  return props;
}

beforeEach(() => localStorage.clear());

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



  it('hides the migrate option in local mode with no local vehicles', () => {
    renderPanel({ user: null, localMode: true, vehiclesMap: {} });
    expect(screen.queryByRole('button', { name: /migrate my vehicles to the cloud/i })).toBeNull();
  });

  it('hides the migrate option entirely when not in local mode', () => {
    renderPanel({ user: null, localMode: false, vehiclesMap: { v1: {} as any } });
    expect(screen.queryByRole('button', { name: /migrate my vehicles to the cloud/i })).toBeNull();
  });

  it('shows the migrate option in local mode with local vehicles, gated behind a confirm dialog', () => {
    renderPanel({ user: null, localMode: true, vehiclesMap: { v1: {} as any, v2: {} as any } });
    const migrateBtn = screen.getByRole('button', { name: /migrate my vehicles to the cloud/i });
    expect(migrateBtn).toBeTruthy();
    // Clicking does NOT immediately reveal Login — it opens a confirm dialog first.
    fireEvent.click(migrateBtn);
    const dialog = screen.getByRole('dialog', { name: /migrate my vehicles to the cloud/i });
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByText(/2 vehicles/)).toBeTruthy();
  });

  it('cancelling the migrate confirm dialog stages nothing and does not open Login', () => {
    const p = renderPanel({ user: null, localMode: true, vehiclesMap: { v1: {} as any } });
    fireEvent.click(screen.getByRole('button', { name: /migrate my vehicles to the cloud/i }));
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(p.setShowLogin).not.toHaveBeenCalled();
    expect(readPendingMigration(localStorage)).toBeNull();
  });

  it('confirming migrate stages the local vehicles BEFORE opening Login (stash-before-wipe ordering)', () => {
    const vehiclesMap = { v1: { id: 'v1', config: { lt_vessel_name: 'Boat One' } } } as any;
    const p = renderPanel({ user: null, localMode: true, vehiclesMap });
    fireEvent.click(screen.getByRole('button', { name: /migrate my vehicles to the cloud/i }));
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    expect(readPendingMigration(localStorage)!.vehicles).toEqual(vehiclesMap);
    expect(p.setShowLogin).toHaveBeenCalledWith(true);
  });

  it('the rebuild "Switch to a cloud account" button discards any previously staged migration', () => {
    const p = renderPanel({ user: null, localMode: true, vehiclesMap: { v1: {} as any } });
    stashPendingMigration({ v1: { id: 'v1', config: {} } }, localStorage);
    expect(localStorage.getItem(PENDING_MIGRATION_KEY)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /switch to a cloud account/i }));
    expect(localStorage.getItem(PENDING_MIGRATION_KEY)).toBeNull();
    expect(p.setShowLogin).toHaveBeenCalledWith(true);
  });

  it('cancelling the inline Login clears any staged migration', () => {
    const p = renderPanel({ user: null, localMode: true, showLogin: true, vehiclesMap: { v1: {} as any } });
    stashPendingMigration({ v1: { id: 'v1', config: {} } }, localStorage);
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(readPendingMigration(localStorage)).toBeNull();
    expect(p.setShowLogin).toHaveBeenCalledWith(false);
  });
});
