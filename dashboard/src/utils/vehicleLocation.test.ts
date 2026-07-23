import { describe, it, expect, beforeEach } from 'vitest';
import {
  getVehicleLocation, saveVehicleLocation, formatCoords, parseCoords, timeAgo, mapsUrl,
  tileForLatLon, tileCanvas, osmTileUrl, TILE_SIZE, LOCATION_KEY,
} from './vehicleLocation';

beforeEach(() => localStorage.clear());

describe('location store', () => {
  it('round-trips a saved location and fires settings_updated', () => {
    let fired = false;
    const onUpd = () => { fired = true; };
    window.addEventListener('settings_updated', onUpd);
    saveVehicleLocation({ lat: 39.0968, lon: -120.0324, acc: 12, ts: 1000, src: 'device' });
    window.removeEventListener('settings_updated', onUpd);
    expect(fired).toBe(true);
    expect(getVehicleLocation()).toEqual({ lat: 39.0968, lon: -120.0324, acc: 12, ts: 1000, src: 'device' });
  });

  it('rejects corrupt / out-of-range stored values', () => {
    localStorage.setItem(LOCATION_KEY, 'garbage');
    expect(getVehicleLocation()).toBeNull();
    localStorage.setItem(LOCATION_KEY, JSON.stringify({ lat: 999, lon: 0, ts: 1 }));
    expect(getVehicleLocation()).toBeNull();
    localStorage.setItem(LOCATION_KEY, '');
    expect(getVehicleLocation()).toBeNull();
  });
});

describe('coordinate formatting/parsing', () => {
  it('formats hemispheres', () => {
    expect(formatCoords(39.0968, -120.0324)).toBe('39.0968° N, 120.0324° W');
    expect(formatCoords(-33.86, 151.21)).toBe('33.8600° S, 151.2100° E');
  });

  it('parses "lat, lon" text and rejects junk', () => {
    expect(parseCoords('39.0968, -120.0324')).toEqual({ lat: 39.0968, lon: -120.0324 });
    expect(parseCoords(' 39 -120 ')).toEqual({ lat: 39, lon: -120 });
    expect(parseCoords('not coords')).toBeNull();
    expect(parseCoords('99, 0')).toBeNull();   // lat out of range
    expect(parseCoords('0, 190')).toBeNull();  // lon out of range
  });

  it('builds a maps URL', () => {
    expect(mapsUrl(39.0968, -120.0324)).toBe('https://maps.google.com/?q=39.096800,-120.032400');
  });
});

describe('timeAgo', () => {
  it('buckets sensibly', () => {
    const now = 1_800_000_000_000;
    expect(timeAgo(now - 10_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(timeAgo(now - 3 * 86_400_000, now)).toBe('3 d ago');
  });
});

describe('slippy tile math', () => {
  it('maps the origin to the center tile', () => {
    const { xf, yf } = tileForLatLon(0, 0, 4);
    expect(xf).toBeCloseTo(8);
    expect(yf).toBeCloseTo(8);
  });

  it('matches a known OSM reference tile', () => {
    // https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames example region (zoom 16, Sydney-ish)
    const { xf, yf } = tileForLatLon(-33.87, 151.21, 16);
    expect(Math.floor(xf)).toBe(60294);
    expect(Math.floor(yf)).toBe(39327);
  });

  it('builds a centered tile canvas with the marker offset inside it', () => {
    const c = tileCanvas(39.0968, -120.0324, 13, 5, 4);
    expect(c.width).toBe(5 * TILE_SIZE);
    expect(c.height).toBe(4 * TILE_SIZE);
    expect(c.tiles.length).toBe(20);
    // marker offset falls within the canvas
    expect(c.offsetX).toBeGreaterThan(0);
    expect(c.offsetX).toBeLessThan(c.width);
    expect(c.offsetY).toBeGreaterThan(0);
    expect(c.offsetY).toBeLessThan(c.height);
    for (const t of c.tiles) expect(t.url).toMatch(/^https:\/\/tile\.openstreetmap\.org\/13\/\d+\/\d+\.png$/);
  });

  it('wraps tile x across the antimeridian', () => {
    const c = tileCanvas(0, 179.9, 3, 5, 4); // 2^3 = 8 tiles worldwide; grid must wrap
    expect(c.tiles.length).toBe(20);
    for (const t of c.tiles) {
      const m = t.url.match(/\/3\/(\d+)\/(\d+)\.png$/)!;
      expect(Number(m[1])).toBeGreaterThanOrEqual(0);
      expect(Number(m[1])).toBeLessThan(8);
    }
  });

  it('formats tile URLs', () => {
    expect(osmTileUrl(13, 1234, 3065)).toBe('https://tile.openstreetmap.org/13/1234/3065.png');
  });
});
