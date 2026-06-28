// Per-vehicle integration API tokens (open-tasks Task 14, Premium `canIntegrations`). Tokens let
// external integrations (Home Assistant / MQTT / webhooks) authenticate to the user's cloud/self-host
// server later. SCAFFOLD: tokens are generated, listed, and revoked here and stored in the synced
// per-vehicle config field `sh_api_tokens`; no server currently validates them (that lands with the
// integration endpoints). Pure list ops are unit-tested; only randomToken() touches Web Crypto.

export interface ApiToken {
  token: string;
  label: string;
  /** Epoch ms the token was issued. */
  createdAt: number;
}

const PREFIX = 'brvg_';

/** A random opaque token, `brvg_<48 hex chars>`. Uses Web Crypto (browser/native WebView). */
export function randomToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  (globalThis.crypto ?? crypto).getRandomValues(arr);
  return PREFIX + Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Mask a token for display: keep the prefix + a short tail, hide the middle. */
export function maskToken(token: string): string {
  if (token.length <= PREFIX.length + 4) return token;
  return `${token.slice(0, PREFIX.length + 4)}…${token.slice(-4)}`;
}

export function parseApiTokens(raw: string | null | undefined): ApiToken[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((t): t is ApiToken => !!t && typeof t.token === 'string' && t.token.length > 0)
      .map((t) => ({ token: t.token, label: String(t.label ?? ''), createdAt: Number(t.createdAt) || 0 }));
  } catch {
    return [];
  }
}

export function serializeApiTokens(tokens: ApiToken[]): string {
  return JSON.stringify(tokens);
}

/** Add a token (no-op on a duplicate token value). Label is trimmed; blank → "Untitled". */
export function addApiToken(tokens: ApiToken[], token: string, label: string, now: number): ApiToken[] {
  if (!token || tokens.some((t) => t.token === token)) return tokens;
  return [...tokens, { token, label: label.trim() || 'Untitled', createdAt: now }];
}

/** Revoke a token by its value (no-op if absent). */
export function revokeApiToken(tokens: ApiToken[], token: string): ApiToken[] {
  if (!tokens.some((t) => t.token === token)) return tokens;
  return tokens.filter((t) => t.token !== token);
}
