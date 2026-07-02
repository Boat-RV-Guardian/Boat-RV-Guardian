import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  it('defaults to the Free plan when no tier is set', () => {
    render(<Account />);
    // Both the plan-name header and the price line read "Free", so match at least one.
    expect(screen.getAllByText('Free').length).toBeGreaterThan(0);
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
    localStorage.setItem('lt_vehicle_tier', 'premium'); // export is a Premium feature (canExport)
    render(<Account />);
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

  it('switches the active vehicle in-portal from the per-vehicle plans list', async () => {
    localStorage.setItem('lt_vehicles', JSON.stringify({
      v1: { id: 'v1', config: { lt_vessel_name: 'Boat A', tier: 'basic' } },
      v2: { id: 'v2', config: { lt_vessel_name: 'Boat B', tier: 'free' } },
    }));
    localStorage.setItem('lt_active_vehicle_id', 'v1');
    // switchVehicle backs up *root* lt_*/tier keys into the outgoing vehicle's map entry before
    // loading the new one — mirroring real usage, where the root keys always reflect the live active
    // vehicle. Seed them to match v1 so that backup-on-switch doesn't clobber "Boat A" with defaults.
    localStorage.setItem('lt_vessel_name', 'Boat A');
    localStorage.setItem('tier', 'basic');
    render(<Account />);
    expect(screen.queryAllByRole('button', { name: /^switch$/i }).length).toBe(1); // only the inactive row offers Switch
    fireEvent.click(screen.getByRole('button', { name: /^switch$/i }));
    // switchVehicle runs behind a lazy import + dispatches settings_updated async — wait for the
    // localStorage write rather than the pre-existing "active" badge text (which is already on screen
    // for v1 before the click, so asserting on its mere presence would race the switch).
    await waitFor(() => expect(localStorage.getItem('lt_active_vehicle_id')).toBe('v2'));
    // Boat A (now inactive) offers Switch instead of Boat B.
    expect(await screen.findByText('Boat A')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^switch$/i }).length).toBe(1);
  });

  it('generates and revokes an integration API token (Premium)', () => {
    localStorage.setItem('lt_vehicle_tier', 'premium'); // integrations are Premium-gated
    render(<Account />);
    fireEvent.change(screen.getByPlaceholderText(/label/i), { target: { value: 'Home Assistant' } });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    expect(screen.getByText('Home Assistant')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('sh_api_tokens')!).length).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: /revoke/i }));
    expect(JSON.parse(localStorage.getItem('sh_api_tokens')!).length).toBe(0);
  });

  // --- Entitlement gating (Task 2/3): the SMS + integrations sections lock on non-Premium tiers ---
  it('gates the SMS section behind Premium on the Free plan', () => {
    localStorage.setItem('lt_vehicle_tier', 'free'); // canSmsAlert = false
    render(<Account />);
    expect(screen.getByText(/SMS & voice alerts \(Premium\)/i)).toBeTruthy();
    expect(screen.getByText(/upgrade to premium to add phone numbers/i)).toBeTruthy();
    expect(screen.queryByPlaceholderText(/555 123 4567/)).toBeNull(); // no phone input when gated
  });

  it('gates the integrations section behind Premium on the Free plan', () => {
    localStorage.setItem('lt_vehicle_tier', 'free'); // canIntegrations = false
    render(<Account />);
    expect(screen.getByText(/Integrations & API tokens \(Premium\)/i)).toBeTruthy();
    expect(screen.getByText(/upgrade to premium to create tokens/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /generate/i })).toBeNull(); // no generate when gated
  });

  it('opens the SMS + integrations inputs on a Premium plan', () => {
    localStorage.setItem('lt_vehicle_tier', 'premium');
    render(<Account />);
    // SMS + WhatsApp both use the phone placeholder; Telegram + integrations add their own inputs.
    expect(screen.getAllByPlaceholderText(/555 123 4567/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByPlaceholderText(/@username or chat id/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /generate/i })).toBeTruthy();
  });

  // --- Opt-in Basic trial (owner decision: not auto-granted) ---
  it('offers the opt-in Basic trial for a signed-in user on a Free vehicle with no trial yet', () => {
    localStorage.setItem('lt_vehicle_tier', 'free');
    render(<Account user={{ uid: 'u1', email: 'a@b.c' }} />);
    expect(screen.getByRole('button', { name: /start free trial/i })).toBeTruthy();
  });

  it('hides the trial offer when signed out', () => {
    localStorage.setItem('lt_vehicle_tier', 'free');
    render(<Account />);
    expect(screen.queryByRole('button', { name: /start free trial/i })).toBeNull();
  });

  it('hides the trial offer once the vehicle is no longer Free', () => {
    localStorage.setItem('lt_vehicle_tier', 'basic');
    render(<Account user={{ uid: 'u1', email: 'a@b.c' }} />);
    expect(screen.queryByRole('button', { name: /start free trial/i })).toBeNull();
  });

  // Delete-account UI gating (Task 14 GDPR). We exercise the confirm flow up to — but not including —
  // the irreversible action (clicking it would hit Firebase via the lazy import).
  it('hides the delete-account control when signed out', () => {
    render(<Account />);
    expect(screen.queryByRole('button', { name: /^delete account$/i })).toBeNull();
  });

  it('requires typing DELETE before the permanent-delete button enables', () => {
    render(<Account user={{ uid: 'u1', email: 'a@b.c' }} />);
    fireEvent.click(screen.getByRole('button', { name: /^delete account$/i }));
    const danger = screen.getByRole('button', { name: /permanently delete/i }) as HTMLButtonElement;
    expect(danger.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), { target: { value: 'DELETE' } });
    expect((screen.getByRole('button', { name: /permanently delete/i }) as HTMLButtonElement).disabled).toBe(false);
  });
});
