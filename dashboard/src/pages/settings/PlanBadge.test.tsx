import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlanBadge from './PlanBadge';

// Component test for the compact plan indicator (open-tasks Task 6). Driven by
// localStorage['lt_vehicle_tier'] (what SyncModal stashes); unset → grandfathered Premium.

beforeEach(() => {
  localStorage.removeItem('lt_vehicle_tier');
});

describe('PlanBadge', () => {
  it('shows the tier and a "Manage plan" button for Premium (grandfathered/unset)', () => {
    render(<PlanBadge />);
    expect(screen.getByText('Premium')).toBeTruthy();
    expect(screen.getByRole('button', { name: /manage plan/i })).toBeTruthy();
  });

  it('shows an Upgrade button for non-Premium tiers', () => {
    localStorage.setItem('lt_vehicle_tier', 'free');
    render(<PlanBadge />);
    expect(screen.getByText('Free')).toBeTruthy();
    expect(screen.getByRole('button', { name: /upgrade/i })).toBeTruthy();
  });

  it('shows Upgrade for Basic too', () => {
    localStorage.setItem('lt_vehicle_tier', 'basic');
    render(<PlanBadge />);
    expect(screen.getByText('Basic')).toBeTruthy();
    expect(screen.getByRole('button', { name: /upgrade/i })).toBeTruthy();
  });
});
