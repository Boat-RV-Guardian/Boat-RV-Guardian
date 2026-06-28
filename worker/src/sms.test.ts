import { describe, it, expect, vi } from 'vitest';
import {
  canSmsAlertForTier, smsRecipientsForEvent, noopSmsSender, dispatchSmsForEvent,
  type SmsSender, type SmsPrefs,
} from './sms';

const PREFS: SmsPrefs = { phones: ['+15551112222', '+15553334444'], events: ['flood', 'offline'] };

describe('canSmsAlertForTier', () => {
  it('is Premium-only', () => {
    expect(canSmsAlertForTier('premium')).toBe(true);
    expect(canSmsAlertForTier('basic')).toBe(false);
    expect(canSmsAlertForTier('free')).toBe(false);
    expect(canSmsAlertForTier(null)).toBe(false);
    expect(canSmsAlertForTier(undefined)).toBe(false);
    expect(canSmsAlertForTier('gold')).toBe(false);
  });
});

describe('smsRecipientsForEvent', () => {
  it('returns opted-in numbers for a Premium vehicle on an opted event', () => {
    expect(smsRecipientsForEvent('premium', PREFS, 'flood')).toEqual(['+15551112222', '+15553334444']);
  });
  it('blocks non-Premium tiers entirely', () => {
    expect(smsRecipientsForEvent('basic', PREFS, 'flood')).toEqual([]);
    expect(smsRecipientsForEvent('free', PREFS, 'flood')).toEqual([]);
  });
  it('returns [] for an event the user has not opted into', () => {
    expect(smsRecipientsForEvent('premium', PREFS, 'low_battery')).toEqual([]);
  });
  it('returns [] with no prefs / no phones / no event', () => {
    expect(smsRecipientsForEvent('premium', null, 'flood')).toEqual([]);
    expect(smsRecipientsForEvent('premium', { phones: [], events: ['flood'] }, 'flood')).toEqual([]);
    expect(smsRecipientsForEvent('premium', PREFS, '')).toEqual([]);
  });
  it('trims, de-dupes, and drops blank numbers', () => {
    const prefs: SmsPrefs = { phones: [' +1555 ', '+1555', '+1555', '', '   '], events: ['flood'] };
    expect(smsRecipientsForEvent('premium', prefs, 'flood')).toEqual(['+1555']);
  });
});

describe('noopSmsSender', () => {
  it('sends nothing and reports not-configured', async () => {
    expect(await noopSmsSender.sendSms('+15550000000', 'hi')).toEqual({ ok: false, error: 'no SMS provider configured' });
  });
});

describe('dispatchSmsForEvent', () => {
  it('attempts every entitled recipient and counts successes', async () => {
    const sent: string[] = [];
    const sender: SmsSender = { async sendSms(to) { sent.push(to); return { ok: true }; } };
    expect(await dispatchSmsForEvent(sender, 'premium', PREFS, 'flood', 'Flood!')).toEqual({ attempted: 2, sent: 2 });
    expect(sent).toEqual(['+15551112222', '+15553334444']);
  });
  it('does nothing when the vehicle is not entitled', async () => {
    const sender = { sendSms: vi.fn() };
    expect(await dispatchSmsForEvent(sender, 'basic', PREFS, 'flood', 'x')).toEqual({ attempted: 0, sent: 0 });
    expect(sender.sendSms).not.toHaveBeenCalled();
  });
  it('with the noop sender, attempts but sends zero (scaffold)', async () => {
    expect(await dispatchSmsForEvent(noopSmsSender, 'premium', PREFS, 'flood', 'x')).toEqual({ attempted: 2, sent: 0 });
  });
  it('one provider failure does not abort the rest', async () => {
    let n = 0;
    const sender: SmsSender = { async sendSms() { n++; if (n === 1) throw new Error('boom'); return { ok: true }; } };
    expect(await dispatchSmsForEvent(sender, 'premium', PREFS, 'flood', 'x')).toEqual({ attempted: 2, sent: 1 });
  });
});
