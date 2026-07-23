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




  it('shows trial status when a future trial end is stashed', () => {
    localStorage.setItem('lt_vehicle_trial_ends', String(Date.now() + 5 * 86_400_000));
    render(<Account />);
    expect(screen.getByText(/days left/i)).toBeTruthy();
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

  it('gates the integrations section behind Premium on the Free plan', () => {
    localStorage.setItem('lt_vehicle_tier', 'free'); // canIntegrations = false
    render(<Account />);
    expect(screen.getByText(/Integrations & API tokens \(Premium\)/i)).toBeTruthy();
    expect(screen.getByText(/upgrade to premium to create tokens/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /generate/i })).toBeNull(); // no generate when gated
  });

  // Messaging/SMS prefs moved to Settings → MessagingChannelPrefs (covered by its own test);
  // Account keeps the integrations tokens.
  it('opens the integrations inputs on a Premium plan', () => {
    localStorage.setItem('lt_vehicle_tier', 'premium');
    render(<Account />);
    expect(screen.getByRole('button', { name: /generate/i })).toBeTruthy();
  });

  // Data export / GDPR reports moved to the web portal (account.boatrvguardian.com).
  it('links out to the privacy portal instead of exporting in-app', () => {
    render(<Account />);
    expect(screen.getByRole('button', { name: /privacy portal/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /export.*csv/i })).toBeNull();
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
