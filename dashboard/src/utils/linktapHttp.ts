// LinkTap transport + response parsing, extracted from LinkTapWidget.
//
// The widget talks to the LinkTap gateway/cloud over three different runtimes: a Tauri command
// (raw_linktap_post, to bypass desktop CORS), Capacitor's native HTTP plugin (Android/iOS CORS),
// and plain browser/Tauri fetch. `unifiedFetch` papers over those. The pure helpers below
// (extractJsonFromMaybeHtml / coerceWateringBool) are the fiddly parsing bits that benefit most
// from unit tests — the LinkTap local API sometimes wraps its JSON in an HTML page, and the
// "is watering" flag arrives as any of true/'true'/1/'1' depending on firmware/source.

export const isTauriEnv = () =>
  typeof window !== 'undefined' && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).isTauri);

export const invokeTauri = async (cmd: string, args?: any) => {
  if (isTauriEnv()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(cmd, args);
  }
  throw new Error('Tauri API not available');
};

export const listenTauri = async (event: string, handler: (e: any) => void) => {
  if (isTauriEnv()) {
    const { listen } = await import('@tauri-apps/api/event');
    return listen(event, handler);
  }
  return () => {};
};

export interface UnifiedResponse {
  text: () => Promise<string>;
  json: () => Promise<any>;
  ok: boolean;
  status: number;
}

export const unifiedFetch = async (url: string, options?: any): Promise<UnifiedResponse> => {
  if (isTauriEnv() && options?.method === 'POST' && !url.startsWith('https://')) {
    // Extract IP from URL (e.g. http://192.168.1.100/api.shtml)
    const ip = url.replace('http://', '').split('/')[0];
    const rawText: string = (await invokeTauri('raw_linktap_post', {
      ip,
      payload: options.body || '',
    })) as string;
    return {
      text: async () => rawText,
      json: async () => JSON.parse(rawText),
      ok: true,
      status: 200,
    };
  }

  // On Android/iOS, try to use native HTTP to bypass all WebView CORS
  if (typeof (window as any).Capacitor !== 'undefined') {
    const Cap = (window as any).Capacitor;
    if (Cap.isNativePlatform() && Cap.Plugins && Cap.Plugins.CapacitorHttp) {
      try {
        const res = await Cap.Plugins.CapacitorHttp.request({
          method: options?.method || 'GET',
          url: url,
          headers: {
            'Content-Type': 'application/json',
            'Accept': '*/*',
            ...(options?.headers || {}),
          },
          // Send exactly the string provided, do not parse to Object so it's not reformatted
          data: options?.body,
          connectTimeout: 5000,
          readTimeout: 5000,
        });
        return {
          text: async () => (typeof res.data === 'string' ? res.data : JSON.stringify(res.data)),
          json: async () => (typeof res.data === 'string' ? JSON.parse(res.data) : res.data),
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
        };
      } catch (nativeErr: any) {
        throw new Error(`Native HTTP Error (${url}): ${nativeErr.message || JSON.stringify(nativeErr)}`);
      }
    }
  }

  let timeoutId: any;
  const controller = new AbortController();
  if (typeof AbortSignal !== 'undefined' && (AbortSignal as any).timeout) {
    options = { ...options, signal: (AbortSignal as any).timeout(5000) };
  } else {
    timeoutId = setTimeout(() => controller.abort(), 5000);
    options = { ...options, signal: controller.signal };
  }

  try {
    const res = await fetch(url, options);
    return res as unknown as UnifiedResponse;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

/**
 * The LinkTap local API (api.shtml) sometimes returns its JSON wrapped in an HTML page. Return the
 * substring that looks like the JSON object so the caller can JSON.parse it; if no HTML wrapper is
 * present the input is returned unchanged.
 */
export function extractJsonFromMaybeHtml(rawText: string): string {
  if (rawText.includes('<html') || rawText.includes('<body')) {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) return match[0];
  }
  return rawText;
}

/** Normalize LinkTap's "is watering" flag, which arrives as true/'true'/1/'1' across sources. */
export function coerceWateringBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1';
}
