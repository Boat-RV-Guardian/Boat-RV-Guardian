import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import SubscriptionPanel from './SubscriptionPanel';

// First component test in the repo — establishes RTL infra (open-tasks Task 2/9: component tests for
// entitlement/role-gated UI). Renders the real panel through the real useEntitlements hook, driven by
// localStorage['lt_vehicle_tier'] (the value SyncModal stashes).

beforeEach(() => {
  localStorage.removeItem('lt_vehicle_tier');
});

function rowValue(label: string): string {
  // Each row is "<icon> <label> ... <value>"; find the row container and read its last cell.
  const labelEl = screen.getByText(label);
  const row = labelEl.closest('div')!.parentElement!; // span(label) -> wrapping row div
  return within(row).getAllByText(/.+/).map((n) => n.textContent).join('|');
}

describe('SubscriptionPanel', () => {
  it('shows Premium with price for an unset (grandfathered) vehicle', () => {
    render(<SubscriptionPanel />);
    expect(screen.getByRole('heading', { name: 'Plan' })).toBeTruthy();
    expect(screen.getByText('Premium')).toBeTruthy();
    expect(screen.getByText('$5/mo · $30/yr')).toBeTruthy();
  });

  it('shows Free and no price for a free-tier vehicle, with remote control = Local only', () => {
    localStorage.setItem('lt_vehicle_tier', 'free');
    render(<SubscriptionPanel />);
    expect(screen.getByText('Free')).toBeTruthy();
    expect(screen.queryByText(/\/mo ·/)).toBeNull(); // no price line for free
    // Remote control row shows "Local only" at the free tier
    expect(rowValue('Remote control')).toContain('Local only');
  });

  it('shows the full feature checklist (stable row set)', () => {
    render(<SubscriptionPanel />);
    for (const label of ['Remote monitoring', 'Remote control', 'Cloud automation', 'History', 'Priority support']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });
});
