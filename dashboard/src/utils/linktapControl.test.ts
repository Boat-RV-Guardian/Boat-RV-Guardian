import { describe, it, expect, vi } from 'vitest';
import { controlBody, sendLinkTapControl } from './linktapControl';

describe('controlBody', () => {
  it('carries vid + action; open includes a rounded durationSec', () => {
    expect(controlBody('v1', 'open', 120.6)).toEqual({ vid: 'v1', action: 'open', durationSec: 121 });
  });
  it('omits durationSec for close (and for a non-positive open duration)', () => {
    expect(controlBody('v1', 'close', 0)).toEqual({ vid: 'v1', action: 'close' });
    expect('durationSec' in controlBody('v1', 'open', 0)).toBe(false);
    expect('durationSec' in controlBody('v1', 'open')).toBe(false);
  });
});

const okRes = (body: any) => ({ ok: true, status: 200, async text() { return ''; }, async json() { return body; } });
const errRes = (status: number, txt = '') => ({ ok: false, status, async text() { return txt; }, async json() { return {}; } });

describe('sendLinkTapControl', () => {
  it('POSTs to /api/control with the bearer token + body, and reports ok on ≥1 valve', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okRes({ status: 'ok', action: 'open', valves: 1 }));
    const r = await sendLinkTapControl('https://api.x', 'TOKEN', 'v1', 'open', 60, fetchFn);
    expect(r.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.x/api/control');
    expect(init.headers.Authorization).toBe('Bearer TOKEN');
    expect(JSON.parse(init.body)).toEqual({ vid: 'v1', action: 'open', durationSec: 60 });
  });

  it('treats a partial success (≥1 valve) as ok, but zero valves as failure', async () => {
    expect((await sendLinkTapControl('b', 't', 'v', 'close', undefined, vi.fn().mockResolvedValue(okRes({ status: 'partial', valves: 1 })))).ok).toBe(true);
    expect((await sendLinkTapControl('b', 't', 'v', 'close', undefined, vi.fn().mockResolvedValue(okRes({ status: 'partial', valves: 0 })))).ok).toBe(false);
  });

  it('reports the HTTP error (e.g. 403 monitor-role rejection) so the caller can fall back', async () => {
    const r = await sendLinkTapControl('b', 't', 'v', 'open', 60, vi.fn().mockResolvedValue(errRes(403, '{"error":"forbidden"}')) as any);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('403');
  });

  it('never throws — a network error becomes ok:false', async () => {
    const r = await sendLinkTapControl('b', 't', 'v', 'close', undefined, vi.fn().mockRejectedValue(new Error('offline')) as any);
    expect(r).toEqual({ ok: false, error: 'offline' });
  });
});
