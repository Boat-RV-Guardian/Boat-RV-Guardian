/**
 * TIME & TIMESTAMP POLICY  —  read this before touching any date/time code.
 *
 *   STORAGE  → always UTC. Persist timestamps as epoch milliseconds (number) or as
 *              ISO-8601 strings via `Date.prototype.toISOString()`. NEVER persist a
 *              localized/formatted time string, and never persist a wall-clock value
 *              without its zone. (Example of correct storage: the per-device usage
 *              history buckets in LinkTapWidget use `new Date().toISOString()`.)
 *
 *   DISPLAY  → always render through the helpers below. They format in the device's
 *              configured time zone — the `lt_tz` setting — which is a device-local
 *              preference (NOT cloud-synced; see LOCAL_ONLY_KEYS in configSync.ts) that
 *              defaults to the OS-resolved zone. Do NOT call `toLocaleTimeString` /
 *              `toLocaleDateString` / `toLocaleString` directly in components: those use
 *              the raw browser zone and silently ignore the user's `lt_tz` choice.
 *
 * `lt_tz` can change at runtime. Components that show times should re-read it on the
 * `settings_updated` event (e.g. keep a `displayTz` state) so already-rendered times
 * reformat when the user switches zones.
 */

export type Stamp = Date | number | string;

/** The time zone the UI should render in: the `lt_tz` preference, else the OS zone, else UTC. */
export function getDisplayTimeZone(): string {
  const tz = localStorage.getItem('lt_tz');
  if (tz) return tz;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const toDate = (input: Stamp): Date => (input instanceof Date ? input : new Date(input));

const withZone = (opts?: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions => ({
  timeZone: getDisplayTimeZone(),
  ...opts,
});

/** Time-of-day in the device's configured zone. Input must be a UTC stamp. */
export function formatTime(input: Stamp, opts?: Intl.DateTimeFormatOptions): string {
  const d = toDate(input);
  try {
    return d.toLocaleTimeString([], withZone(opts));
  } catch {
    return d.toLocaleTimeString([], opts); // invalid tz string → fall back to browser zone
  }
}

/** Calendar date in the device's configured zone. Input must be a UTC stamp. */
export function formatDate(input: Stamp, opts?: Intl.DateTimeFormatOptions): string {
  const d = toDate(input);
  try {
    return d.toLocaleDateString([], withZone(opts));
  } catch {
    return d.toLocaleDateString([], opts);
  }
}

/** Combined date + time in the device's configured zone. Input must be a UTC stamp. */
export function formatDateTime(input: Stamp, opts?: Intl.DateTimeFormatOptions): string {
  const d = toDate(input);
  try {
    return d.toLocaleString([], withZone(opts));
  } catch {
    return d.toLocaleString([], opts);
  }
}
