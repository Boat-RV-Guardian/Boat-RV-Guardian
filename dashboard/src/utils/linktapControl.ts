// Route valve open/close through the worker's role-checked /api/control instead of the app calling
// LinkTap's cloud directly. This is the command half of retiring the multi-instance race: only the
// server holds/uses the LinkTap creds and only one authority actuates the valve, so a stale app copy
// can't fight over it. The app still keeps a local-gateway fallback for on-LAN / offline (in the widget).

export interface ControlResult {
  ok: boolean;
  error?: string;
}

/** Build the /api/control POST body. Open MUST carry a bounded duration (the valve never runs unbounded). */
export function controlBody(vid: string, action: 'open' | 'close', durationSec?: number): Record<string, unknown> {
  const body: Record<string, unknown> = { vid, action };
  if (action === 'open' && typeof durationSec === 'number' && durationSec > 0) body.durationSec = Math.round(durationSec);
  return body;
}

type FetchLike = (url: string, init: any) => Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<any> }>;

/**
 * Send a role-checked control command to the worker. `base` is the worker URL (DEFAULT_WORKER_URL),
 * `idToken` the caller's Firebase ID token (the worker verifies it + the caller's member role).
 * Returns ok only when ≥1 valve actuated.
 */
export async function sendLinkTapControl(
  base: string,
  idToken: string,
  vid: string,
  action: 'open' | 'close',
  durationSec?: number,
  fetchFn: FetchLike = fetch as any,
): Promise<ControlResult> {
  try {
    const res = await fetchFn(`${base.replace(/\/$/, '')}/api/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(controlBody(vid, action, durationSec)),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, error: `control ${res.status}${txt ? `: ${txt}` : ''}` };
    }
    const data: any = await res.json().catch(() => ({}));
    if ((data.status === 'ok' || data.status === 'partial') && (data.valves || 0) > 0) return { ok: true };
    return { ok: false, error: data.error || `control failed (${data.status || 'no status'})` };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}
