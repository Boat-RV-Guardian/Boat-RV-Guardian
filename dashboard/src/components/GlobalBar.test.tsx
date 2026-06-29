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
  it('shows the active vehicle label and an account button', () => {
    seed({ v1: { name: 'Serenity', type: 'boat' } }, 'v1');
    const onOpenAccount = vi.fn();
    render(<GlobalBar onOpenAccount={onOpenAccount} />);
    expect(screen.getByText('⛵ Serenity')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /account/i }));
    expect(onOpenAccount).toHaveBeenCalled();
  });

  it('opens a dropdown listing all vehicles when there is more than one', () => {
    seed({ v1: { name: 'Serenity', type: 'boat' }, v2: { name: 'Wanderer', type: 'rv' } }, 'v1');
    render(<GlobalBar onOpenAccount={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(screen.getByRole('option', { selected: true }).textContent).toContain('Serenity');
  });

  it('does not offer a dropdown with a single vehicle', () => {
    seed({ v1: { name: 'Serenity', type: 'boat' } }, 'v1');
    render(<GlobalBar onOpenAccount={vi.fn()} />);
    const switcher = screen.getByRole('button', { name: /switch vehicle/i });
    fireEvent.click(switcher);
    expect(screen.queryByRole('option')).toBeNull();
  });
});
