import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SoftwareUpdatesPanel from './SoftwareUpdatesPanel';

describe('SoftwareUpdatesPanel', () => {
  it('shows the current version and an "up to date" note when latest matches', () => {
    render(<SoftwareUpdatesPanel appVersion="1.0.45" latestVersion="1.0.45" />);
    expect(screen.getByText(/v1\.0\.45/)).toBeTruthy();
    expect(screen.getByText(/up to date/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeTruthy();
  });

  it('prompts to download when a newer version is available', () => {
    render(<SoftwareUpdatesPanel appVersion="1.0.45" latestVersion="1.0.46" />);
    expect(screen.getByText(/new update available/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /download update/i })).toBeTruthy();
  });

  it('does not claim up-to-date before the latest version is known (null)', () => {
    render(<SoftwareUpdatesPanel appVersion="1.0.45" latestVersion={null} />);
    expect(screen.queryByText(/up to date/i)).toBeNull();
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeTruthy();
  });
});
