import { describe, it, expect } from 'vitest';
import { parseDigestChallenge } from './shellyRpc';

describe('parseDigestChallenge', () => {
  it('parses the Gen3 header form (empty body, WWW-Authenticate header) with a numeric nonce', () => {
    // Exact shape captured from a live PM Mini G3 (fw 1.1.99), 2026-07-22.
    const c = parseDigestChallenge(undefined,
      'Digest qop="auth", realm="shellypmminig3-dcb4d9db00fc", nonce="1784763526", algorithm=SHA-256');
    expect(c).toEqual({ realm: 'shellypmminig3-dcb4d9db00fc', nonce: 1784763526 });
  });

  it('parses the older JSON-RPC body form', () => {
    const c = parseDigestChallenge(JSON.stringify({ auth_type: 'digest', realm: 'shellyplus1-abc', nonce: 1620000000, nc: 1 }), undefined);
    expect(c).toEqual({ realm: 'shellyplus1-abc', nonce: 1620000000 });
  });

  it('prefers the body form but falls back to the header when the body is not a challenge', () => {
    const c = parseDigestChallenge('Not JSON at all',
      'Digest qop="auth", realm="r1", nonce="42", algorithm=SHA-256');
    expect(c).toEqual({ realm: 'r1', nonce: 42 });
  });

  it('returns null when neither form is present (caller raises a clear error)', () => {
    expect(parseDigestChallenge(undefined, undefined)).toBeNull();
    expect(parseDigestChallenge('', '')).toBeNull();
  });
});
