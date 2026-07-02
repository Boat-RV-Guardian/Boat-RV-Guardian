import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SoftwareUpdatesPanel from './SoftwareUpdatesPanel';
import type { UseAppUpdater } from '../../hooks/useAppUpdater';

// Minimal fixture builder — only the fields a given branch reads are ever asserted on, but the type
// requires all of them.
function tauriState(overrides: Partial<UseAppUpdater>): UseAppUpdater {
  return {
    status: 'idle', version: null, progressText: null, error: null,
    checkForUpdate: vi.fn(), installUpdate: vi.fn(),
    ...overrides,
  };
}

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

  // --- Task 13 part 3: the real Tauri desktop update flow ---
  it('falls back to the GitHub link when unsupported (web/Capacitor, or before the check resolves)', () => {
    render(<SoftwareUpdatesPanel appVersion="1.0.45" latestVersion={null} tauriUpdate={tauriState({ status: 'unsupported' })} />);
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeTruthy();
  });

  it('offers a real install button when a Tauri update is available', () => {
    const installUpdate = vi.fn();
    render(<SoftwareUpdatesPanel appVersion="1.0.45" latestVersion="1.0.46" tauriUpdate={tauriState({ status: 'available', version: '1.0.46', installUpdate })} />);
    const btn = screen.getByRole('button', { name: /download & install v1\.0\.46/i });
    expect(btn).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^download update$/i })).toBeNull(); // GitHub-link button replaced, not duplicated
    fireEvent.click(btn);
    expect(installUpdate).toHaveBeenCalled();
  });

  it('shows download progress while downloading', () => {
    render(<SoftwareUpdatesPanel appVersion="1.0.45" latestVersion="1.0.46" tauriUpdate={tauriState({ status: 'downloading', progressText: 'Downloading… 42% (2.1 / 5.0 MB)' })} />);
    expect(screen.getByText(/42%/)).toBeTruthy();
  });

  it('shows the installed/restart message when ready', () => {
    render(<SoftwareUpdatesPanel appVersion="1.0.45" latestVersion="1.0.46" tauriUpdate={tauriState({ status: 'ready', progressText: 'Update installed — restart to finish.' })} />);
    expect(screen.getByText(/restart to finish/i)).toBeTruthy();
  });

  it('does NOT surface a failed background check as user-facing text (expected/common until a real manifest is published) — falls back to the GitHub link instead', () => {
    render(<SoftwareUpdatesPanel appVersion="1.0.45" latestVersion="1.0.45" tauriUpdate={tauriState({ status: 'error', error: 'network unreachable' })} />);
    expect(screen.queryByText(/network unreachable/i)).toBeNull();
    expect(screen.getByText(/up to date/i)).toBeTruthy(); // the real (pre-existing) signal still shows
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeTruthy();
  });

  it('DOES surface a failed install — the user just clicked a button, so silence would look like a hang', () => {
    render(<SoftwareUpdatesPanel appVersion="1.0.45" latestVersion={null} tauriUpdate={tauriState({ status: 'install-error', error: 'signature verification failed' })} />);
    expect(screen.getByText(/signature verification failed/i)).toBeTruthy();
  });
});
