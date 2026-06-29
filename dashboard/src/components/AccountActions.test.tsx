import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AccountActions from './AccountActions';
import { enterLocalMode } from '../utils/userScope';

beforeEach(() => localStorage.clear());

describe('AccountActions', () => {
  it('shows cloud mode + a sign-out when signed in', () => {
    render(<AccountActions user={{ email: 'me@example.com' }} />);
    expect(screen.getByText(/cloud \(synced\)/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /switch to a cloud account/i })).toBeNull();
  });

  it('shows local-only mode + a switch-to-cloud entry, no sign-out', () => {
    enterLocalMode('abc', localStorage);
    render(<AccountActions user={null} />);
    expect(screen.getByText(/local-only/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /switch to a cloud account/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull();
  });

  it('reports signed out when neither signed in nor local', () => {
    render(<AccountActions user={null} />);
    expect(screen.getByText(/signed out/i)).toBeTruthy();
  });
});
