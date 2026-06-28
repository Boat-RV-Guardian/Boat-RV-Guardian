import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Account from './Account';

// Integration: redeeming a coupon changes the active vehicle's plan (mock billing → entitlements →
// reactive UI), end to end, without the native app.

beforeEach(() => {
  localStorage.clear();
  // jsdom doesn't implement object URLs — stub them for the CSV export path.
  (URL as any).createObjectURL = () => 'blob:mock';
  (URL as any).revokeObjectURL = () => {};
});

describe('Account', () => {
  it('starts on the grandfathered Premium plan when no tier is set', () => {
    render(<Account />);
    expect(screen.getByText('Premium')).toBeTruthy();
  });

  it('applies a coupon and reactively updates the plan', () => {
    render(<Account />);
    fireEvent.change(screen.getByPlaceholderText('Coupon code'), { target: { value: 'GUARDIANBASIC' } });
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(screen.getByText(/now Basic/i)).toBeTruthy();
    expect(screen.getByText('Basic')).toBeTruthy(); // plan header updated via useEntitlements
    expect(localStorage.getItem('lt_vehicle_tier')).toBe('basic');
  });

  it('shows an error for an invalid coupon', () => {
    render(<Account />);
    fireEvent.change(screen.getByPlaceholderText('Coupon code'), { target: { value: 'BOGUS' } });
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(screen.getByText(/invalid or expired/i)).toBeTruthy();
  });

  it('renders the usage & limits section', () => {
    render(<Account />);
    expect(screen.getByText('Usage & limits')).toBeTruthy();
    expect(screen.getByText('Telemetry resolution')).toBeTruthy();
  });

  it('shows trial status when a future trial end is stashed', () => {
    localStorage.setItem('lt_vehicle_trial_ends', String(Date.now() + 5 * 86_400_000));
    render(<Account />);
    expect(screen.getByText(/days left/i)).toBeTruthy();
  });

  it('exports CSV on Premium (enabled, builds from device history, triggers a download)', () => {
    // Seed a device + its on-device usage history so the export actually flattens real buckets.
    localStorage.setItem('lt_devices', JSON.stringify([
      { id: 'd1', type: 'linktap_valve', role: 'Fresh Water', name: 'Tank', linktapDeviceId: 'lt1' },
    ]));
    localStorage.setItem('lt_usage_history_lt1', JSON.stringify({ '2026-06-01T00:00:00.000Z': 5 }));
    let madeWith = '';
    (URL as any).createObjectURL = (b: Blob) => { madeWith = String((b as any).type || 'blob'); return 'blob:x'; };
    render(<Account />); // no tier set → grandfathered Premium → canExport
    const btn = screen.getByRole('button', { name: /export csv/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(madeWith).toContain('text/csv');
  });

  it('disables CSV export on the Free plan', () => {
    localStorage.setItem('lt_vehicle_tier', 'free');
    render(<Account />);
    expect((screen.getByRole('button', { name: /export csv/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a sign-in prompt in the Account section when no user is passed', () => {
    render(<Account />);
    expect(screen.getByText('Account')).toBeTruthy();
    expect(screen.getByText(/sign in to manage/i)).toBeTruthy();
  });

  it('shows the signed-in user email + display name when passed a user', () => {
    render(<Account user={{ email: 'skipper@example.com', displayName: 'Skipper' }} />);
    expect(screen.getByText('skipper@example.com')).toBeTruthy();
    expect(screen.getByText('Skipper')).toBeTruthy();
  });

  it('lists per-vehicle plans when more than one vehicle exists', () => {
    localStorage.setItem('lt_vehicles', JSON.stringify({
      v1: { id: 'v1', config: { lt_vessel_name: 'Boat A', tier: 'basic' } },
      v2: { id: 'v2', config: { lt_vessel_name: 'Boat B', tier: 'free' } },
    }));
    localStorage.setItem('lt_active_vehicle_id', 'v1');
    render(<Account />);
    expect(screen.getByText('Your vehicles & plans')).toBeTruthy();
    expect(screen.getByText('Boat A')).toBeTruthy();
    expect(screen.getByText('Boat B')).toBeTruthy();
    expect(screen.getByText('active')).toBeTruthy();
  });
});
