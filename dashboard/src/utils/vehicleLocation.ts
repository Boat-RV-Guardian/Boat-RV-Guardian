// Vehicle GPS/location: a per-vehicle, cloud-synced last-known position (key lt_vehicle_location in
// VEHICLE_DEFAULT_CONFIG) + the pure OSM "slippy map" tile math the Dashboard mini-map renders with.
// Sources today: this device's GPS (Capacitor Geolocation on native, navigator.geolocation on web)
// or manual entry. A gateway-reported GPS source can layer in later without changing the shape.

export interface VehicleLocation {
  lat: number;
  lon: number;
  /** GPS accuracy radius in meters, when the source provided one. */
  acc?: number;
  /** epoch ms the fix was taken. */
  ts: number;
  src: 'device' | 'manual';
}

export const LOCATION_KEY = 'lt_vehicle_location';

export function getVehicleLocation(storage: Storage = localStorage): VehicleLocation | null {
  try {
    const raw = JSON.parse(storage.getItem(LOCATION_KEY) || 'null');
    if (!raw || !Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) return null;
    if (Math.abs(raw.lat) > 90 || Math.abs(raw.lon) > 180) return null;
    return { lat: raw.lat, lon: raw.lon, acc: Number.isFinite(raw.acc) ? raw.acc : undefined, ts: Number(raw.ts) || 0, src: raw.src === 'manual' ? 'manual' : 'device' };
  } catch { return null; }
}

export function saveVehicleLocation(loc: VehicleLocation, storage: Storage = localStorage): void {
  storage.setItem(LOCATION_KEY, JSON.stringify(loc));
  // settings_updated re-renders listeners AND triggers SyncModal's per-vehicle cloud autosave.
  window.dispatchEvent(new Event('settings_updated'));
}

/** "37.8044° N, 122.2712° W" */
export function formatCoords(lat: number, lon: number): string {
  const la = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`;
  const lo = `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
  return `${la}, ${lo}`;
}

/** Parse a "lat, lon" free-text entry (decimal degrees). Returns null when not parseable. */
export function parseCoords(text: string): { lat: number; lon: number } | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function mapsUrl(lat: number, lon: number): string {
  return `https://maps.google.com/?q=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

// --- OSM slippy-map tile math (https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames) ---------

export const TILE_SIZE = 256;

/** Fractional tile coordinates for a lat/lon at zoom z. */
export function tileForLatLon(lat: number, lon: number, z: number): { xf: number; yf: number } {
  const n = 2 ** z;
  const xf = ((lon + 180) / 360) * n;
  const rad = (lat * Math.PI) / 180;
  const yf = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return { xf, yf };
}

export function osmTileUrl(z: number, x: number, y: number): string {
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

export interface TileCanvas {
  tiles: Array<{ url: string; left: number; top: number }>;
  /** Pixel offset of the marker within the tile canvas — the canvas is positioned so this point
   *  sits at the container's center: left:50%; top:50%; translate(-offsetX, -offsetY). */
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

/**
 * The grid of OSM tiles (cols × rows, centered on the position) plus the marker's pixel offset.
 * Pure — the component just absolutely-positions the imgs and shifts the canvas.
 */
export function tileCanvas(lat: number, lon: number, z: number, cols = 5, rows = 4): TileCanvas {
  const n = 2 ** z;
  const { xf, yf } = tileForLatLon(lat, lon, z);
  const startX = Math.floor(xf) - Math.floor(cols / 2);
  const startY = Math.floor(yf) - Math.floor(rows / 2);
  const tiles: TileCanvas['tiles'] = [];
  for (let r = 0; r < rows; r++) {
    const y = startY + r;
    if (y < 0 || y >= n) continue; // poles: no tile
    for (let c = 0; c < cols; c++) {
      const x = ((startX + c) % n + n) % n; // wrap the antimeridian
      tiles.push({ url: osmTileUrl(z, x, y), left: c * TILE_SIZE, top: r * TILE_SIZE });
    }
  }
  return {
    tiles,
    offsetX: (xf - startX) * TILE_SIZE,
    offsetY: (yf - startY) * TILE_SIZE,
    width: cols * TILE_SIZE,
    height: rows * TILE_SIZE,
  };
}

// --- Acquisition ---------------------------------------------------------------------------------

/**
 * Get this device's position: Capacitor Geolocation on native (handles the runtime permission
 * prompt), navigator.geolocation otherwise. Rejects with a user-showable message.
 */
export async function acquirePosition(): Promise<{ lat: number; lon: number; acc?: number }> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const { Geolocation } = await import('@capacitor/geolocation');
      const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
      return { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy ?? undefined };
    }
  } catch (e: any) {
    // Native path failed (permission denied / location off) — surface it rather than silently
    // falling through to a browser API that will fail the same way.
    if (e?.message && !/not implemented|not available/i.test(e.message)) throw new Error(friendlyGeoError(e));
  }
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(new Error('Location is not available on this device — enter it manually.')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy ?? undefined }),
      (e) => reject(new Error(friendlyGeoError(e))),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });
}

function friendlyGeoError(e: any): string {
  const msg = String(e?.message || e || '');
  if (e?.code === 1 || /denied/i.test(msg)) return 'Location permission denied — allow it in system settings, or enter the position manually.';
  if (e?.code === 3 || /timeout/i.test(msg)) return 'Timed out getting a GPS fix — try again outdoors, or enter the position manually.';
  return `Couldn't get a location fix (${msg || 'unknown error'}) — you can enter it manually.`;
}
