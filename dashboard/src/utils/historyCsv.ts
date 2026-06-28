// Pure CSV export of on-device water-usage history (open-tasks Task 14 "data export" — Premium-gated
// by canExport in the UI). On-device history is `localStorage['lt_usage_history_<deviceId>']`: a map
// of UTC ISO-8601 hour buckets → liters. We flatten every device's buckets into a single tidy CSV,
// sorted by timestamp. Timestamps stay UTC ISO (the project's storage policy); the consumer can
// localize. No I/O here — the component reads localStorage and triggers the download.

export interface DeviceUsage {
  device: string;
  usage: Record<string, number>;
}

/** Escape a CSV field (quote if it contains comma/quote/newline; double internal quotes). */
function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Build a CSV string from per-device usage maps. Columns: `device,timestamp_utc,liters`. Rows are
 * sorted by timestamp then device; non-finite liter values are skipped. Always emits the header (an
 * empty export is just the header row), so the file is well-formed even with no data.
 */
export function usageHistoryToCsv(devices: DeviceUsage[]): string {
  const rows: Array<{ device: string; ts: string; liters: number }> = [];
  for (const d of devices) {
    for (const [ts, liters] of Object.entries(d.usage || {})) {
      const n = Number(liters);
      if (!Number.isFinite(n)) continue;
      rows.push({ device: d.device, ts, liters: n });
    }
  }
  rows.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.device.localeCompare(b.device)));
  const lines = ['device,timestamp_utc,liters'];
  for (const r of rows) lines.push(`${csvField(r.device)},${csvField(r.ts)},${r.liters}`);
  return lines.join('\n');
}
