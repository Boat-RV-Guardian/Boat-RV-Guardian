// Pure helpers for the in-app Tauri updater flow (Settings -> Updates, Task 13 part 3). The plugin
// call itself (useAppUpdater hook) is Tauri-desktop-only and untestable in jsdom (no __TAURI_INTERNALS__,
// same pattern as the other Tauri-gated code in this codebase) — this is the part of that flow worth
// unit-testing on its own.

/** Human-readable download progress. `total` is null until the server reports Content-Length. */
export function formatUpdateProgress(downloadedBytes: number, totalBytes: number | null): string {
  if (downloadedBytes <= 0) return 'Starting download…';
  const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
  if (!totalBytes || totalBytes <= 0) return `Downloading… ${mb(downloadedBytes)} MB`;
  const pct = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
  return `Downloading… ${pct}% (${mb(downloadedBytes)} / ${mb(totalBytes)} MB)`;
}
