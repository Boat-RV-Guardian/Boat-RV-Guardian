// Cross-origin / device HTTP that works whether or not CapacitorHttp's global fetch patch is on.
//
// We keep the global CapacitorHttp patch OFF (it breaks Firestore's long-polling on Android),
// so plain `fetch()` to a different origin would hit WebView CORS. On a native Capacitor platform
// this calls the CapacitorHttp plugin method explicitly to bypass CORS; everywhere else it falls
// back to the browser/Tauri-patched `fetch`. Returns a minimal fetch-Response-like object.
export interface NativeFetchResponse {
  text: () => Promise<string>;
  json: () => Promise<any>;
  ok: boolean;
  status: number;
}

export async function nativeFetch(url: string, options?: any): Promise<NativeFetchResponse> {
  const Cap = (window as any).Capacitor;
  if (Cap?.isNativePlatform?.() && Cap.Plugins?.CapacitorHttp) {
    const res = await Cap.Plugins.CapacitorHttp.request({
      method: options?.method || 'GET',
      url,
      headers: {
        'Content-Type': 'application/json',
        'Accept': '*/*',
        ...(options?.headers || {}),
      },
      // Pass the body through unchanged so JSON strings aren't reformatted.
      data: options?.body,
      connectTimeout: 8000,
      readTimeout: 8000,
    });
    return {
      text: async () => (typeof res.data === 'string' ? res.data : JSON.stringify(res.data)),
      json: async () => (typeof res.data === 'string' ? JSON.parse(res.data) : res.data),
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
    };
  }

  return (await fetch(url, options)) as unknown as NativeFetchResponse;
}
