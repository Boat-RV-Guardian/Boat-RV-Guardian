import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GlobalBar from './GlobalBar';

beforeEach(() => localStorage.clear());

function seed(vehicles: Record<string, { name?: string; type?: string }>, activeId: string) {
  const map: Record<string, any> = {};
  for (const [id, v] of Object.entries(vehicles)) {
    map[id] = { id, config: { ...(v.name ? { lt_vessel_name: v.name } : {}), ...(v.type ? { lt_vehicle_type: v.type } : {}) } };
  }
  localStorage.setItem('lt_vehicles', JSON.stringify(map));
  localStorage.setItem('lt_active_vehicle_id', activeId);
}

describe('GlobalBar', () => {
  // The account button moved out of the global bar into its own Settings tab (2026-07-23 refactor);
  // the bar now owns only the vehicle switcher.
  it('shows the active vehicle label', () => {
    seed({ v1: { name: 'Serenity', type: 'boat' } }, 'v1');
    render(<GlobalBar />);
    expect(screen.getByText('⛵ Serenity')).toBeTruthy();
  });

  it('opens a dropdown listing all vehicles when there is more than one', () => {
    seed({ v1: { name: 'Serenity', type: 'boat' }, v2: { name: 'Wanderer', type: 'rv' } }, 'v1');
    render(<GlobalBar />);
    fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(screen.getByRole('option', { selected: true }).textContent).toContain('Serenity');
  });

  it('opens the menu even with a single vehicle (never a dead click) and offers Manage vehicles', () => {
    seed({ v1: { name: 'Serenity', type: 'boat' } }, 'v1');
    render(<GlobalBar />);
    fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));
    expect(screen.getByRole('option', { selected: true }).textContent).toContain('Serenity');
    expect(screen.getByText(/only one vehicle/i)).toBeTruthy();
    // The manage entry navigates to Settings via the navigate_view event.
    const nav = vi.fn();
    window.addEventListener('navigate_view', nav as EventListener);
    fireEvent.click(screen.getByText(/manage vehicles/i));
    expect(nav).toHaveBeenCalled();
    expect(((nav.mock.calls[0] as any)[0] as CustomEvent).detail).toBe('settings');
    window.removeEventListener('navigate_view', nav as EventListener);
  });
});
