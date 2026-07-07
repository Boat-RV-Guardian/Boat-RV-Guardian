import { describe, it, expect, vi } from 'vitest';
import { linkTapGetApiKey, GET_API_KEY_URL, type CloudFetch } from './linktapCloud';

const fakeFetch = (body: any): CloudFetch =>
  vi.fn(async () => ({ text: async () => JSON.stringify(body) }));

describe('linkTapGetApiKey', () => {
  it('returns the API key from a success response', async () => {
    const f = fakeFetch({ result: 'ok', message: 'KEY-123' });
    await expect(linkTapGetApiKey('user', 'pass', false, f)).resolves.toBe('KEY-123');
  });

  it('POSTs username+password (no replace) to the getApiKey endpoint', async () => {
    const f = fakeFetch({ result: 'ok', message: 'KEY' });
    await linkTapGetApiKey('user', 'pass', false, f);
    expect(f).toHaveBeenCalledWith(GET_API_KEY_URL, expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse((f as any).mock.calls[0][1].body);
    expect(body).toEqual({ username: 'user', password: 'pass' });
  });

  it('includes replace:true only when requested (rotate key)', async () => {
    const f = fakeFetch({ result: 'ok', message: 'NEWKEY' });
    await linkTapGetApiKey('user', 'pass', true, f);
    expect(JSON.parse((f as any).mock.calls[0][1].body)).toEqual({ username: 'user', password: 'pass', replace: true });
  });

  it('throws the LinkTap error message on result:error', async () => {
    const f = fakeFetch({ result: 'error', message: 'Invalid username or password' });
    await expect(linkTapGetApiKey('user', 'bad', false, f)).rejects.toThrow('Invalid username or password');
  });

  it('throws when no key is returned', async () => {
    const f = fakeFetch({ result: 'ok' });
    await expect(linkTapGetApiKey('user', 'pass', false, f)).rejects.toThrow(/did not return an API key/);
  });

  it('validates that username and password are present before calling out', async () => {
    const f = fakeFetch({ result: 'ok', message: 'KEY' });
    await expect(linkTapGetApiKey('', 'pass', false, f)).rejects.toThrow(/username and password/);
    expect(f).not.toHaveBeenCalled();
  });
});
