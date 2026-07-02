import { describe, it, expect, beforeEach } from 'vitest';
import { generateWebhookSecret, ensureWebhookSecret } from './webhookSecret';

beforeEach(() => localStorage.clear());

describe('generateWebhookSecret', () => {
  it('produces a 36-char lowercase hex string', () => {
    const s = generateWebhookSecret();
    expect(s).toMatch(/^[0-9a-f]{36}$/);
  });
  it('is different each call (not a constant)', () => {
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });
});

describe('ensureWebhookSecret', () => {
  it('generates + persists a secret on first call', () => {
    expect(localStorage.getItem('sh_webhook_secret')).toBeNull();
    const s = ensureWebhookSecret();
    expect(s).toMatch(/^[0-9a-f]{36}$/);
    expect(localStorage.getItem('sh_webhook_secret')).toBe(s);
  });
  it('returns the existing secret on subsequent calls (stable)', () => {
    const first = ensureWebhookSecret();
    expect(ensureWebhookSecret()).toBe(first);
  });
});
