import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EditDisplayName from './EditDisplayName';

// These exercise the component's local validation/UX only — Save is never clicked, so no Firebase
// (lazy-imported in the save handler) is touched. The save orchestration is covered in displayName.test.ts.

describe('EditDisplayName', () => {
  it('renders the name read-only with no uid (signed out)', () => {
    render(<EditDisplayName uid={null} displayName="Skipper Joe" />);
    expect(screen.getByText('Skipper Joe')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
  });

  it('shows an Edit button when signed in and reveals the input on click', () => {
    render(<EditDisplayName uid="u1" displayName="Skipper Joe" />);
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect((screen.getByLabelText('Display name') as HTMLInputElement).value).toBe('Skipper Joe');
  });

  it('disables Save until the name is changed and non-empty', () => {
    render(<EditDisplayName uid="u1" displayName="Skipper Joe" />);
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    const save = () => screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
    const input = screen.getByLabelText('Display name');

    expect(save().disabled).toBe(true);              // unchanged
    fireEvent.change(input, { target: { value: '   ' } });
    expect(save().disabled).toBe(true);              // empty after trim
    fireEvent.change(input, { target: { value: 'First Mate' } });
    expect(save().disabled).toBe(false);             // valid change
  });
});
