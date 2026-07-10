import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Render smoke test for the hook-split widget (Task 3): the composition of
// useDeviceHistory / useAlarmNotifications / useLinkTapCommands / useLinkTapPolling /
// useValveSentries has ordering constraints (hooks consume each other's returns) that
// tsc can't check at runtime — a broken hook order/TDZ would only surface on render.
const mocks = vi.hoisted(() => ({
  auth: { currentUser: null },
  onSnapshot: vi.fn(() => () => {}),
  doc: vi.fn(() => ({})),
}));

vi.mock('../services/firebase', () => ({
  auth: mocks.auth,
  db: {},
  doc: mocks.doc,
  onSnapshot: mocks.onSnapshot,
  setDoc: vi.fn(async () => {}),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => undefined })),
}));

// The poll-interval expression reads the __DEMO__ build flag at render time.
(globalThis as any).__DEMO__ = false;

import LinkTapWidget from './LinkTapWidget';

beforeEach(() => localStorage.clear());

describe('LinkTapWidget (hook composition smoke test)', () => {
  it('renders idle with no gateway/cloud configured', () => {
    render(<LinkTapWidget device={{ id: 'DEV1', type: 'linktap', name: 'Test Valve' } as any} />);
    expect(screen.getByText('Test Valve')).toBeTruthy();
    expect(screen.getByText(/CLOSED \(SECURE\)/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Stop Water/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /START NORMAL RUN/i })).toBeTruthy();
  });

  it('shows the monitor-only banner for a monitor-role user', () => {
    localStorage.setItem('lt_my_role', 'monitor');
    render(<LinkTapWidget device={{ id: 'DEV1', type: 'linktap', name: 'Test Valve' } as any} />);
    expect(screen.getByText(/Monitor-only access/i)).toBeTruthy();
  });
});
