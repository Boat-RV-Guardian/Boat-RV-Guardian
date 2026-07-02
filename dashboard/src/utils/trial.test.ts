import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requestTrial } from './trial';
import { DEFAULT_WORKER_URL } from './configSync';

// A fetch stub that records its call and returns a canned JSON response.
function fetchStub(status: number, body: unknown) {
  const calls: Array<{ url: string; init: any }> = [];
  const fetchFn = vi.fn(async (url: string, init: any) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  });
  return { fetchFn, calls };
}

const token = async () => 'tok-123';

describe('requestTrial', () => {
  beforeEach(() => localStorage.clear());

  it('returns an error and does not fetch when not signed in', async () => {
    const { fetchFn } = fetchStub(200, {});
    const r = await requestTrial('v1', { fetchFn, getIdToken: async () => null });
    expect(r).toEqual({ granted: false, error: 'not signed in' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('requires a vid', async () => {
    const { fetchFn } = fetchStub(200, {});
    expect(await requestTrial('', { fetchFn, getIdToken: token })).toEqual({ granted: false, error: 'no vid' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('POSTs the vid + bearer token to the default worker /api/trial', async () => {
    const { fetchFn, calls } = fetchStub(200, { granted: true, tier: 'basic', trialEndsAt: 1234 });
    await requestTrial('v_abc', { fetchFn, getIdToken: token });
    expect(calls[0].url).toBe(`${DEFAULT_WORKER_URL}/api/trial`);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers.Authorization).toBe('Bearer tok-123');
    expect(JSON.parse(calls[0].init.body)).toEqual({ vid: 'v_abc' });
  });

  // SECURITY regression: the ID token must never be sent to a member-settable custom server URL.
  it('IGNORES sh_webhook_url and always posts to the trusted default worker', async () => {
    localStorage.setItem('sh_webhook_url', 'https://my.server.test/');
    const { fetchFn, calls } = fetchStub(200, { granted: true });
    await requestTrial('v1', { fetchFn, getIdToken: token });
    expect(calls[0].url).toBe(`${DEFAULT_WORKER_URL}/api/trial`);
  });

  it('returns granted with normalized tier + trialEndsAt', async () => {
    const { fetchFn } = fetchStub(200, { granted: true, tier: 'basic', trialEndsAt: 1717000000000 });
    expect(await requestTrial('v1', { fetchFn, getIdToken: token })).toEqual({
      granted: true, tier: 'basic', trialEndsAt: 1717000000000,
    });
  });

  it('passes through a not-eligible decline as reason (not an error)', async () => {
    const { fetchFn } = fetchStub(200, { granted: false, reason: 'not eligible (already trialed)' });
    expect(await requestTrial('v1', { fetchFn, getIdToken: token })).toEqual({
      granted: false, reason: 'not eligible (already trialed)',
    });
  });

  it('reports an HTTP error from the worker', async () => {
    const { fetchFn } = fetchStub(403, { error: 'forbidden: only the vehicle owner can start a trial' });
    expect(await requestTrial('v1', { fetchFn, getIdToken: token })).toEqual({
      granted: false, error: 'forbidden: only the vehicle owner can start a trial',
    });
  });

  it('reports a network failure as an error, never throws', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('network down'); }) as unknown as typeof fetch;
    expect(await requestTrial('v1', { fetchFn, getIdToken: token })).toEqual({
      granted: false, error: 'network down',
    });
  });
});
