// LinkTap status normalization, extracted from LinkTapWidget's poll loop.
//
// The widget reads device status from two very differently-shaped sources: the LinkTap cloud API
// (getWateringStatus, with fields like isWatering/onDuration/totalDuration) and the local gateway
// API (already in the widget's native shape). These pure helpers fold the cloud shape into the
// native shape and pull out the watering target, so the gnarly field-coalescing has tests instead
// of living inline in a 200-line poll closure.

/** Per-device battery/signal/online info the widget caches from the cloud getAllDevices endpoint. */
export interface CachedDeviceInfo {
  battery?: number;
  signal?: number;
  status?: string;
}

/** The widget's native status shape (what the local gateway API returns directly). */
export interface NormalizedStatus {
  is_rf_linked: boolean;
  battery: number;
  signal: number;
  is_watering: boolean;
  speed: number;
  volume: number;
  target_volume: number;
  target_duration: number;
  is_broken: boolean;
  remain_duration: number;
}

/**
 * Fold a LinkTap cloud getWateringStatus response into the widget's native status shape, using the
 * separately-cached battery/signal/online info (the cloud status endpoint doesn't include those).
 * Mirrors the field coalescing the widget relied on; tolerant of missing/partial payloads.
 */
export function normalizeCloudStatus(cloudData: any, cached: CachedDeviceInfo): NormalizedStatus {
  const st = cloudData?.status || cloudData || {};
  return {
    is_rf_linked: cached.status !== 'Offline',
    battery: cached.battery || 100,
    signal: cached.signal || 100,
    is_watering: st.isWatering === true || st.watering != null || st.onDuration > 0 || st.status === 'Watering',
    speed: st.vel || st.speed || 0,
    volume: st.vol || st.volume || 0,
    target_volume: st.limit || st.target_vol || (st.watering ? st.watering.vol : 0) || 0,
    target_duration: st.totalDuration || st.total || (st.watering ? st.watering.duration : 0) || 0,
    is_broken: false,
    remain_duration:
      st.remain_duration || st.remainingSeconds || st.remaining ||
      (st.total != null && st.onDuration != null
        ? (Number(st.total) * 60 + Number(st.totalSec || 0)) - (Number(st.onDuration) * 60 + Number(st.onDurSec || 0))
        : 0) ||
      (st.totalDuration ? st.totalDuration * 60 - (st.onDuration || 0) : 0) ||
      (st.watering && st.watering.remaining ? st.watering.remaining * 60 : 0),
  };
}

/**
 * LinkTap's firmware reports battery and signal swapped internally, and that propagates to BOTH the
 * local and cloud APIs — so the widget swaps them back on every poll. Mutates in place (the poll
 * loop reads many other fields off the same object afterward).
 */
export function swapBatterySignal(data: { battery?: any; signal?: any }): void {
  const tempBattery = data.battery;
  data.battery = data.signal;
  data.signal = tempBattery;
}

/** The watering volume target, across the various field names the cloud/local APIs use. */
export function pickTargetVolume(data: any): number {
  return Number(
    data.target_volume ?? data.volume_limit ?? data.limit ?? data.target_vol ?? (data.watering ? data.watering.vol : 0),
  );
}

/** The watering duration target (in the API's native unit — minutes), across field-name variants. */
export function pickTargetDuration(data: any): number {
  return Number(
    data.target_duration ?? data.totalDuration ?? data.total ?? (data.watering ? data.watering.duration : 0),
  );
}
