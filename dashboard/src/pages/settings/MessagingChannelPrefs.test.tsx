import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MessagingChannelPrefs from './MessagingChannelPrefs';
import { EMPTY_SMS_PREFS } from '../../utils/smsPrefs';

const base = {
  title: 'Telegram alerts',
  lockedNote: 'Upgrade to Premium.',
  description: 'Add chats.',
  emptyLabel: 'No chats yet.',
};

describe('MessagingChannelPrefs', () => {
  it('shows only the locked note when the tier is not unlocked', () => {
    render(<MessagingChannelPrefs {...base} unlocked={false} prefs={EMPTY_SMS_PREFS} onChange={vi.fn()} variant="handle" inputPlaceholder="@x" />);
    expect(screen.getByText(/Telegram alerts \(Premium\)/i)).toBeTruthy();
    expect(screen.getByText(/Upgrade to Premium/i)).toBeTruthy();
    expect(screen.queryByPlaceholderText('@x')).toBeNull();
  });

  it('adds a freeform handle (variant=handle) without phone normalization', () => {
    const onChange = vi.fn();
    render(<MessagingChannelPrefs {...base} unlocked prefs={EMPTY_SMS_PREFS} onChange={onChange} variant="handle" inputPlaceholder="@x" />);
    fireEvent.change(screen.getByPlaceholderText('@x'), { target: { value: '@skipper' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onChange).toHaveBeenCalledWith({ phones: ['@skipper'], events: [] });
  });

  it('validates + normalizes a phone (variant=phone) and rejects junk', () => {
    const onChange = vi.fn();
    render(<MessagingChannelPrefs {...base} title="SMS" unlocked prefs={EMPTY_SMS_PREFS} onChange={onChange} variant="phone" inputPlaceholder="+1" />);
    const input = screen.getByPlaceholderText('+1');
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/valid destination/i)).toBeTruthy();

    fireEvent.change(input, { target: { value: '+1 (555) 123-4567' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onChange).toHaveBeenCalledWith({ phones: ['+15551234567'], events: [] });
  });

  it('toggles an event opt-in', () => {
    const onChange = vi.fn();
    render(<MessagingChannelPrefs {...base} unlocked prefs={EMPTY_SMS_PREFS} onChange={onChange} variant="handle" inputPlaceholder="@x" />);
    fireEvent.click(screen.getByLabelText(/flood/i));
    expect(onChange).toHaveBeenCalledWith({ phones: [], events: ['flood'] });
  });
});
