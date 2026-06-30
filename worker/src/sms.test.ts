import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  canSmsAlertForTier, smsRecipientsForEvent, noopSmsSender, dispatchSmsForEvent, parseSmsPrefs,
  smsSenderFromEnv, twilioSmsSender,
  type SmsSender, type SmsPrefs,
} from './sms';

describe('parseSmsPrefs', () => {
  it('parses a serialized prefs string, de-duping + trimming', () => {
    const raw = JSON.stringify({ phones: [' +15551112222 ', '+15551112222', ''], events: ['flood', 'flood', 'offline'] });
    expect(parseSmsPrefs(raw)).toEqual({ phones: ['+15551112222'], events: ['flood', 'offline'] });
  });
  it('returns empty prefs for null/garbage/non-arrays', () => {
    expect(parseSmsPrefs(null)).toEqual({ phones: [], events: [] });
    expect(parseSmsPrefs('not json')).toEqual({ phones: [], events: [] });
    expect(parseSmsPrefs(JSON.stringify({ phones: 'x', events: 3 }))).toEqual({ phones: [], events: [] });
  });
});

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

describe('smsSenderFromEnv', () => {
  it('returns the noop sender unless all three Twilio secrets are present', async () => {
    expect(smsSenderFromEnv({}) === noopSmsSender).toBe(true);
    expect(smsSenderFromEnv({ accountSid: 'AC', authToken: 't' }) === noopSmsSender).toBe(true);
    expect(smsSenderFromEnv({ accountSid: 'AC', authToken: 't', from: '+1' }) === noopSmsSender).toBe(false);
  });
});

describe('twilioSmsSender', () => {
  const origFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = origFetch; });

  it('POSTs to the Twilio Messages API with From for a phone number and returns ok on 2xx', async () => {
    let captured: any = null;
    globalThis.fetch = (async (url: any, init: any) => {
      captured = { url, body: init.body, auth: init.headers.Authorization };
      return { ok: true, status: 201, text: async () => '' } as any;
    }) as any;
    const r = await twilioSmsSender({ accountSid: 'AC123', authToken: 'tok', from: '+15550001111' }).sendSms('+15552223333', 'hi');
    expect(r.ok).toBe(true);
    expect(captured.url).toContain('/Accounts/AC123/Messages.json');
    expect(captured.body).toContain('To=%2B15552223333');
    expect(captured.body).toContain('From=%2B15550001111');
    expect(captured.auth.startsWith('Basic ')).toBe(true);
  });

  it('uses MessagingServiceSid when `from` is an MG SID', async () => {
    let body = '';
    globalThis.fetch = (async (_url: any, init: any) => { body = init.body; return { ok: true, status: 201, text: async () => '' } as any; }) as any;
    await twilioSmsSender({ accountSid: 'AC', authToken: 't', from: 'MGabc' }).sendSms('+1', 'x');
    expect(body).toContain('MessagingServiceSid=MGabc');
    expect(body).not.toContain('From=');
  });

  it('surfaces a non-2xx response as ok:false without throwing', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 401, text: async () => 'unauthorized' } as any)) as any;
    const r = await twilioSmsSender({ accountSid: 'AC', authToken: 'bad', from: '+1' }).sendSms('+1', 'x');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/401/);
  });

  it('reports not-configured when creds are missing', async () => {
    const r = await twilioSmsSender({}).sendSms('+1', 'x');
    expect(r.ok).toBe(false);
  });
});
