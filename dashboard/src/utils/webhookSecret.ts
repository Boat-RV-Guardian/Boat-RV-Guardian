// Per-vehicle webhook bearer secret (SEC-4). Shelly devices fire a static URL and can't sign
// requests, so the strongest auth they can carry is a secret embedded in the webhook URL as
// `&k=<secret>`. The hosted worker verifies it per request (see brvg-cloud-server messaging/auth).
//
// The secret is a SYNCED per-vehicle config field (`sh_webhook_secret`) so it rides the normal cloud
// config sync into the vehicle doc, where the worker reads it. Generated once per vehicle, on demand.

/** Generate a random URL-safe webhook secret (144 bits, hex). */
export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(18);
  (globalThis.crypto ?? crypto).getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Return the active vehicle's webhook secret, generating + persisting one if it doesn't exist yet.
 * Firing `settings_updated` lets SyncModal push it to the cloud like any other config field.
 */
export function ensureWebhookSecret(): string {
  const existing = localStorage.getItem('sh_webhook_secret');
  if (existing) return existing;
  const secret = generateWebhookSecret();
  localStorage.setItem('sh_webhook_secret', secret);
  window.dispatchEvent(new Event('settings_updated'));
  return secret;
}
