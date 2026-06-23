import { fetch } from '@tauri-apps/plugin-http';

export interface LinkTapCredentials {
  username: string;
  apiKey: string;
}

export interface LinkTapDeviceCreds extends LinkTapCredentials {
  gatewayId: string;
  taplinkerId: string;
}

const API_BASE = 'https://www.link-tap.com/api';

async function makeRequest(endpoint: string, data: any) {
  // Use Tauri's native fetch if inside Tauri to bypass CORS, otherwise fallback to browser fetch
  const isTauri = !!(window as any).__TAURI_INTERNALS__;
  const fetcher = isTauri ? fetch : window.fetch.bind(window);

  const response = await fetcher(`${API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  const text = await response.text();
  try {
    const json = JSON.parse(text);
    if (json.result === 'error') {
      throw new Error(json.message || 'Link-Tap API Error');
    }
    return json;
  } catch (e: any) {
    throw new Error(e.message || `Failed to parse response: ${text}`);
  }
}

export const LinkTapAPI = {
  getAllDevices: async (creds: LinkTapCredentials) => {
    return makeRequest('getAllDevices', creds);
  },

  turnOnV2: async (creds: LinkTapDeviceCreds, durationMinutes: number) => {
    return makeRequest('turnOnV2', {
      ...creds,
      action: true,
      duration: durationMinutes,
      autoBack: true
    });
  },

  turnOffV2: async (creds: LinkTapDeviceCreds) => {
    return makeRequest('turnOffV2', {
      ...creds,
      action: false,
      autoBack: true
    });
  }
};
