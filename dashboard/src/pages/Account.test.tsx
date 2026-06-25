import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Account from './Account';

// Integration: redeeming a coupon changes the active vehicle's plan (mock billing → entitlements →
// reactive UI), end to end, without the native app.

beforeEach(() => {
  localStorage.removeItem('tier');
  localStorage.removeItem('lt_vehicle_tier');
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
});
