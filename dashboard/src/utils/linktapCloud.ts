// LinkTap cloud-account API (link-tap.com/api/*). Today: getApiKey — create/retrieve the account's
// API key from the username + password, so the user never has to visit LinkTap's developer page to
// copy a key by hand. LinkTap's cloud has no CORS headers, so on Tauri desktop the WebView fetch is
// blocked — route through the native HTTP plugin there; use CapacitorHttp on mobile (via nativeFetch)
// and a plain fetch on the web.

import { nativeFetch } from './nativeFetch';

const isTauriEnv = () =>
  typeof window !== 'undefined' && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).isTauri);

export interface CloudResponse {
  text: () => Promise<string>;
}
export type CloudFetch = (url: string, options?: any) => Promise<CloudResponse>;

/** Transport for LinkTap's https cloud API, papering over Tauri / Capacitor / web CORS differences. */
export const linkTapCloudFetch: CloudFetch = async (url, options) => {
  if (isTauriEnv()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(url, {
      method: options?.method || 'GET',
      headers: options?.headers,
      body: options?.body,
    }) as unknown as CloudResponse;
  }
  return nativeFetch(url, options) as unknown as CloudResponse;
};

export const GET_API_KEY_URL = 'https://www.link-tap.com/api/getApiKey';

/**
 * Create or retrieve the LinkTap API key for an account (LinkTap `POST /api/getApiKey`).
 *
 * - `replace=false` (default) returns the account's existing key (or creates one if none exists).
 * - `replace=true` generates a NEW key, invalidating any key other apps hold — use only for an
 *   explicit "rotate / lock out other apps" action.
 *
 * The password is used for this one call and must NEVER be persisted; only the returned key is stored.
 * Returns the API key string. Throws on a LinkTap `result: 'error'` (e.g. bad credentials).
 */
export async function linkTapGetApiKey(
  username: string,
  password: string,
  replace = false,
  fetchImpl: CloudFetch = linkTapCloudFetch,
): Promise<string> {
  if (!username || !password) throw new Error('Enter your LinkTap username and password.');
  const body = replace ? { username, password, replace: true } : { username, password };
  const res = await fetchImpl(GET_API_KEY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data: any;
  try {
    data = JSON.parse(await res.text());
  } catch {
    throw new Error('LinkTap returned an unreadable response. Check your connection and try again.');
  }
  // LinkTap's REAL responses (verified live 2026-07-07) don't match their docs: success is
  // {"key":"<api key>"} and an error is {"message":"Invalid password"} — no `result` field on
  // either. Accept the real shape first, keep the documented {result,message} success shape as a
  // fallback, and treat a bare `message` as the error channel it actually is.
  if (typeof data?.key === 'string' && data.key) return data.key;
  if (data?.result && data.result !== 'error' && typeof data.message === 'string' && data.message) return data.message;
  throw new Error(typeof data?.message === 'string' && data.message ? data.message : 'LinkTap did not return an API key.');
}
