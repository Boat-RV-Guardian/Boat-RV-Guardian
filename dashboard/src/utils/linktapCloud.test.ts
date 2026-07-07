import { describe, it, expect, vi } from 'vitest';
import { linkTapGetApiKey, GET_API_KEY_URL, type CloudFetch } from './linktapCloud';

const fakeFetch = (body: any): CloudFetch =>
  vi.fn(async () => ({ text: async () => JSON.stringify(body) }));

describe('linkTapGetApiKey', () => {
  it('returns the key from the REAL success shape ({key}) — verified live, docs are wrong', async () => {
    const f = fakeFetch({ key: '1e3a94eb7bc0b138e57bfc176847d4' });
    await expect(linkTapGetApiKey('user', 'pass', false, f)).resolves.toBe('1e3a94eb7bc0b138e57bfc176847d4');
  });

  it('throws the REAL error shape (bare {message}) as the error it is, never as a key', async () => {
    const f = fakeFetch({ message: 'Invalid password' });
    await expect(linkTapGetApiKey('user', 'bad', false, f)).rejects.toThrow('Invalid password');
  });

  it('still accepts the documented {result, message} success shape as a fallback', async () => {
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
