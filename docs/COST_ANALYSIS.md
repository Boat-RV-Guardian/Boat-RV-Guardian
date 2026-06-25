# Data-volume & cost analysis — hosted backend choice

**Status:** analysis for open-tasks Task 8. Created 2026-06-25. **Pricing verified 2026-06-25**
against the official Cloudflare D1 / Workers and Firestore pricing pages (links at bottom) — re-check
before relying on exact numbers, vendor pricing drifts.

**Bottom line:** go **Cloudflare-native (Workers + D1)** for the paid-tier hosted backend. A single
flat **$5/mo Workers Paid plan covers ~100+ vehicles** before any overage, versus **Firestore
billing out of pocket past ~3–7 vehicles**. D1 is SQLite, so it also pairs directly with the
self-host Docker story (Task 7 — same SQL, swap the binding for libSQL/better-sqlite3). Keep
**Firebase Auth + FCM** (free, already integrated, separate concern). And adopt one **mandatory
design rule: downsample telemetry** — never store raw 60-second samples for years.

---

## 1. Ingest model

**Assumptions** (per the 2026-06-25 product decision): **4 devices per vehicle average** for Basic +
Premium users. Device mix (conservative):

| Device | Cadence | Webhooks/day/vehicle |
|---|---|---|
| Voltmeter (Shelly Plus Uni) | telemetry every **60 s** | 1,440 |
| Temperature / 2nd telemetry | telemetry every **60 s** | 1,440 |
| Flood sensor (battery, sleeps) | event-driven (rare) | ~0 |
| LinkTap valve | usage hourly + commands | ~24 |
| **Total** | | **≈ 2,900 / day / vehicle** |

> ⚠️ **The 60-second telemetry is the entire cost driver.** Flood/LinkTap are noise next to it.
> See §5 — cutting voltmeter cadence to 5 min (or report-on-change) drops cost ~5×.

**Work per webhook** (today's worker): 1 read of the vehicle doc + 1 write of `sensorState` (FCM is
skipped for `*.measurement`/`*.change`). If the hosted **history** feature also persists each sample,
add **+1 write**.

Per vehicle:
- **Writes/day:** ~2,900 (sensorState only) → ~5,800 (with history).
- **Reads/day:** ~2,900 (vehicle doc per webhook; cacheable — see §5).
- **Monthly (×30):** writes 87k → 174k; reads ~87k.

---

## 2. Firestore (current backend)

**Verified rates:** reads **$0.06 / 100k**, writes **$0.18 / 100k**, deletes **$0.02 / 100k**,
storage ~**$0.18 / GiB-mo**. **Spark (free):** 50k reads/day, **20k writes/day**, 1 GiB storage,
10 GiB/mo egress — *project-wide, resets daily*.

**Free-tier ceiling (writes bind first):**
- sensorState only: 20,000 ÷ 2,900 ≈ **~7 vehicles**
- with history: 20,000 ÷ 5,800 ≈ **~3 vehicles**

**Marginal cost past free, per vehicle/month:**
- Writes: 174k × $0.18/100k ≈ **$0.31** (with history); 87k ≈ $0.16 (sensorState only)
- Reads: 87k × $0.06/100k ≈ **$0.05**
- ≈ **$0.20–0.36 / vehicle / month**, before storage.

So Firestore is cheap *per vehicle* but the **free runway is tiny** (a handful of boats), and storage
for long-resolution history gets expensive fast (per-document overhead + mandatory indexes).

---

## 3. Cloudflare-native (Workers + D1)

**Verified D1 pricing:** Free — 5M rows read/day, **100k rows written/day**, 5 GB storage. Paid
(rides the **$5/mo Workers Paid** plan) — **25B rows read/mo** + **50M rows written/mo** included,
then $0.001/M read, **$1.00/M written**, storage 5 GB included + $0.75/GB-mo. **No egress charges.**
**Workers:** Free — 100k requests/**day**. Paid $5/mo — **10M requests/mo** included, then $0.30/M.

**Free-tier ceilings (per day, project-wide):**
- Workers requests: 100,000 ÷ 2,900 ≈ **~34 vehicles**
- D1 writes: 100,000 ÷ 5,800 ≈ **~17 vehicles** (with history) / ~34 (sensorState only)

**$5/mo Paid plan capacity (binding constraint = Workers requests, then D1 writes):**
- Requests: 10M ÷ 87k ≈ **~114 vehicles** included
- D1 writes: 50M ÷ 174k ≈ **~287 vehicles** included
- D1 reads: 25B/mo — effectively unlimited at this scale

→ **One $5/mo plan ≈ 100+ vehicles.** Beyond that, marginal ≈ $0.026 (requests) + $0.17 (writes) ≈
**~$0.20 / vehicle / month** — comparable to Firestore's marginal, but with a **15–30× higher free/
included floor**.

---

## 4. Storage growth (history retention — Premium 1–3 yr)

Raw 60-second samples, stored forever, are the trap:

- 60s samples/year/device = 525,600; two telemetry devices ≈ **1.05M samples/year/vehicle**.
- D1 row ≈ ~80 B → **~84 MB/year/vehicle** raw; 3 yr ≈ **~250 MB/vehicle**. At 100 vehicles that's
  ~25 GB → past the 5 GB free, ~$15/mo. Firestore would be far worse (per-doc overhead + indexes).

**With downsampling** (raw 1-min only for the recent Basic window, then **hourly** aggregates for
long-term): 8,760 rows/yr/device × 2 ≈ 17.5k rows/yr/vehicle ≈ **~1.4 MB/yr/vehicle**; 3 yr ≈
**~4 MB/vehicle**. At 100 vehicles ≈ 0.4 GB — **storage becomes a non-issue** on either backend.

---

## 5. Cost levers (apply regardless of backend)

1. **Downsample/roll up telemetry (mandatory).** Raw resolution for the recent window (Basic
   1 wk–1 mo); hourly/daily aggregates for Premium long-term. Bounds both write volume and storage.
2. **Reduce telemetry cadence or report-on-change.** Voltmeter every 5 min instead of 60 s cuts the
   dominant cost ~5×. Battery voltage rarely needs 1-minute resolution.
3. **Cache the vehicle doc** in the worker (per-vehicle, short TTL) to kill the per-webhook read.
4. **Coalesce writes.** Buffer N samples / T seconds and write once (Durable Object or in-memory
   within an isolate) — turns 2,900 writes/day into far fewer.

---

## 6. Recommendation

| | Firestore | **Cloudflare (Workers + D1)** |
|---|---|---|
| Free runway | ~3–7 vehicles | **~17–34 vehicles** |
| $5/mo covers | n/a (usage-billed) | **~100+ vehicles** |
| Marginal/vehicle/mo at scale | ~$0.20–0.36 | ~$0.20 |
| Egress | charged | **free** |
| Self-host (Docker) fit | needs GCP SA key | **D1 = SQLite → libSQL/better-sqlite3** |
| Vendor | + Google | same as existing worker |

**Adopt Cloudflare-native for hosted paid-tier data (sensorState + history) on D1.** Keep **Firebase
Auth + FCM** as-is (free, decoupled). Vehicle/user **config docs** are low-volume — they can stay on
Firestore cheaply for now, or migrate to D1 later for one-vendor simplicity (not urgent). Make
**telemetry downsampling** a first-class requirement of the history feature (Task 6), not an
afterthought.

**Out-of-pocket thresholds to watch (pro-bono budget):** Firestore Spark ≈ **3–7 vehicles**;
Cloudflare free ≈ **17–34 vehicles/day**; Cloudflare $5/mo ≈ **~100 vehicles**. These set when the
project starts paying and where the Basic ($3/mo) / Premium ($5/mo) revenue must cover infra.

> VPS route was considered and de-prioritized by the owner (2026-06-25) — kept out of scope here.

---

### Sources (verified 2026-06-25)
- [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Firestore pricing (Google Cloud)](https://cloud.google.com/firestore/pricing)
- [Firestore billing (Firebase)](https://firebase.google.com/docs/firestore/pricing)
