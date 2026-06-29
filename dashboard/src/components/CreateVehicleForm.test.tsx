import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CreateVehicleForm from './CreateVehicleForm';

describe('CreateVehicleForm', () => {
  it('disables Create until both a name and a type are chosen', () => {
    render(<CreateVehicleForm onCreate={() => {}} />);
    const create = () => screen.getByRole('button', { name: /create vehicle/i }) as HTMLButtonElement;
    expect(create().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/vehicle name/i), { target: { value: 'Sea Breeze' } });
    expect(create().disabled).toBe(true); // name only — still need a type

    fireEvent.click(screen.getByRole('button', { name: /boat/i }));
    expect(create().disabled).toBe(false);
  });

  it('calls onCreate with the trimmed name and chosen type', () => {
    const onCreate = vi.fn();
    render(<CreateVehicleForm onCreate={onCreate} />);
    fireEvent.change(screen.getByLabelText(/vehicle name/i), { target: { value: '  Wanderer  ' } });
    fireEvent.click(screen.getByRole('button', { name: /rv/i }));
    fireEvent.click(screen.getByRole('button', { name: /create vehicle/i }));
    expect(onCreate).toHaveBeenCalledWith('Wanderer', 'rv');
  });
});
