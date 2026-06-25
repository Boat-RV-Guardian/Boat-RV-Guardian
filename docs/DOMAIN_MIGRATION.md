# Domain migration → `boatrvguardian.com` subdomains

Created 2026-06-25 (open-tasks Task 11). **Prep only — no code flipped.** User-facing URLs should
live on `boatrvguardian.com`, not vendor hosts (`*.workers.dev`, `*.firebaseapp.com`, `*.pages.dev`).

**Scheme (decided 2026-06-25; domain is on Cloudflare):**

| Subdomain | Serves | Platform |
|---|---|---|
| `api.boatrvguardian.com` | the webhooks/actions **worker** | Cloudflare Workers custom domain |
| `app.boatrvguardian.com` | the **dashboard** web app | Cloudflare Pages (already referenced) |
| `admin.boatrvguardian.com` | the **admin** site (Task 12, future) | Cloudflare Pages |
| `boatrvguardian.com` / `www.` | marketing **website** (separate repo) | Cloudflare Pages |

## Inventory — user-exposed vendor URLs in THIS repo

1. **`DEFAULT_WORKER_URL`** — [dashboard/src/utils/configSync.ts:75](../dashboard/src/utils/configSync.ts)
   = `https://boat-rv-guardian-webhooks.jgearinger.workers.dev`. **The critical one.** This is baked
   into Shelly devices as their webhook target (`?vid=…&event=…`), and used as the default in
   [ProvisionShellyModal.tsx](../dashboard/src/components/ProvisionShellyModal.tsx) (3 sites) and the
   per-vehicle override `sh_webhook_url`. → migrate to `https://api.boatrvguardian.com`.
2. **Firebase `authDomain`** — [dashboard/src/services/firebase.ts:7](../dashboard/src/services/firebase.ts)
   = `boat-rv-guardian-9f8a4.firebaseapp.com`. Shows briefly in Google OAuth. *Optional* to move
   (Firebase Hosting custom auth domain) — low priority, leave for now.
3. **Settings copy** — [Settings.tsx:851/853](../dashboard/src/pages/Settings.tsx) references
   `…workers.dev` as the example for a **self-hoster's own** worker. That's legitimate (it's THEIR
   server, not ours) — optionally mention `api.boatrvguardian.com` as the hosted default. Leave.

(The web-app host `app.boatrvguardian.com` already appears in
[LOCAL_API_SETUP.md](../LOCAL_API_SETUP.md), so the dashboard's Pages custom domain is likely already
attached. The marketing site lives in the separate private website repo — migrate its host there.)

## Cutover plan for the worker URL (devices cache it — order matters)

1. **Attach the custom domain** to the worker first, so BOTH URLs serve it (zero downtime). Either:
   - Cloudflare dashboard → Workers & Pages → `boat-rv-guardian-webhooks` → Settings → Triggers →
     **Custom Domains → Add `api.boatrvguardian.com`** (Cloudflare auto-creates the DNS record), or
   - `wrangler.toml`:
     ```toml
     routes = [{ pattern = "api.boatrvguardian.com", custom_domain = true }]
     ```
     ⚠️ Only add this **after** the zone is ready, or the next auto-deploy (push to `worker/**`)
     will fail. Apply via dashboard first to de-risk.
2. **Verify** `https://api.boatrvguardian.com/api/shelly?...` returns the same as the `workers.dev`
   URL (200/404, not error).
3. **Flip `DEFAULT_WORKER_URL`** to `https://api.boatrvguardian.com` (one-line change, separate PR).
4. **Re-register device webhooks:** already-provisioned Shelly devices keep the OLD URL until the app
   re-registers them on a successful local poll (per CLAUDE.md). So:
   - **Keep the old `*.workers.dev` route live indefinitely** — do NOT delete it, or
     not-yet-updated devices lose their away-from-home alerts + flood shutoff.
   - Re-provision / open the app near each device once to migrate its webhooks.

## DNS records the owner must add (Cloudflare zone `boatrvguardian.com`)

| Name | Type | Target | How |
|---|---|---|---|
| `api` | (auto) | the worker | Workers → Custom Domains (auto-creates record) |
| `app` | CNAME | Pages project (dashboard) | Pages → Custom domains |
| `admin` | CNAME | Pages project (admin, future) | Pages → Custom domains |
| `@` / `www` | CNAME | Pages project (website) | in the website repo's Pages project |

Custom-domain validation is handled by Cloudflare; no app rebuild is needed to add a record. After
step 3 ships, smoke-test a real flood on a re-provisioned device end-to-end (docs/TESTING.md).
