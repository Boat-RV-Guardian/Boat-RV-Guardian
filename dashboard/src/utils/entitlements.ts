// Per-vehicle subscription entitlements (open-tasks Task 6).
//
// Decisions (2026-06-25): entitlements attach PER-VEHICLE ("Plex model" — the vehicle owner pays and
// people they SHARE the vehicle with inherit that vehicle's tier when accessing it). Billing is
// scaffolded now and provider-agnostic; Stripe drops in later. This module is PURE (no I/O) so it's
// trivially testable and reusable on the worker for server-side enforcement.
//
// Tier model (the cloud is the paid product; local + self-hosted is free forever):
//   free    — MANUAL remote VIEW (pull-only: open app + tap Update, throttled; no auto-refresh/push),
//             cloud settings sync, vehicle sharing, local control + local flood shutoff.
//   basic   — automatic remote VIEW + remote CONTROL + away push + cloud flood-shutoff fallback +
//             ESSENTIAL automation (timers/schedules, single-condition rules) + ~1 month history.
//   premium — high-res telemetry + 1–3 yr history + ADVANCED automation (conditional/chained,
//             sequences, away-mode) + SMS/voice escalation + integrations + export + priority support.
//
// "Control" here = LOCAL control is always free (on-LAN / app-open); the gated thing is REMOTE
// (off-LAN) control. "Automation" here = CLOUD automation run by the worker; the in-app Flooding
// Sentry that runs while the app is open is local and unaffected by tier.

export type Tier = 'free' | 'basic' | 'premium';

/** Cloud-automation capability level per tier. */
export type AutomationLevel = 'none' | 'essential' | 'advanced';

/** Tiers low→high. Used by `tierAtLeast`. */
export const TIER_ORDER: readonly Tier[] = ['free', 'basic', 'premium'] as const;

/** Automation levels low→high. Used by `automationAtLeast`. */
export const AUTOMATION_ORDER: readonly AutomationLevel[] = ['none', 'essential', 'advanced'] as const;

/** Length of the one-month free Basic trial (tracked per-user AND per-vehicle — see open-tasks). */
export const BASIC_TRIAL_DAYS = 30;

/**
 * The tier assumed for a vehicle that has no `tier` field yet (legacy / pre-billing vehicles).
 * Set to `premium` so the entitlement layer can ship WITHOUT changing behavior for anyone — existing
 * single-user owners keep full access. Once the admin "set tier" switch / Stripe assign real tiers,
 * stored values take over. Do NOT lower this default to 'free' until billing + the admin override
 * exist, or every current user instantly loses remote control of their own boat.
 */
export const GRANDFATHERED_TIER: Tier = 'premium';

export interface Entitlements {
  tier: Tier;

  // — Remote access (off-LAN) —
  /** Can view cached state off-LAN at all. */
  canRemoteView: boolean;
  /** Free: view is pull-only — user must tap "Update"; no auto-refresh/background polling. */
  remoteViewManualOnly: boolean;
  /** Minimum seconds between manual remote refreshes (Free throttle; 0 = no throttle). */
  remoteRefreshMinIntervalSec: number;
  /** Send valve/device commands off-LAN. (Local control is always free.) */
  canRemoteControl: boolean;
  /** Push notifications when the app is closed (away alerts). */
  canAwayPush: boolean;
  /** Worker closes the valve on a flood when no app is running (cloud safety fallback). */
  canCloudFloodShutoff: boolean;

  // — Cloud automation (worker-run) —
  automationLevel: AutomationLevel;

  // — Alerts —
  /** SMS / voice (call) escalation on specific events (premium). */
  canSmsAlert: boolean;

  // — Data —
  /** How often the worker PERSISTS telemetry for this vehicle (cost + freshness lever). */
  telemetryResolutionSec: number;
  /** Days of HOSTED history retained (0 = none; on-device history is separate + always available). */
  historyRetentionDays: number;
  /** Export history to CSV / reports (premium). */
  canExport: boolean;

  // — Integrations —
  /** Home Assistant / MQTT / IFTTT / outbound webhooks (premium). */
  canIntegrations: boolean;

  // — Always-on (free) —
  /** Cloud settings/config sync + backup (needed so a shared viewer's devices match). */
  canCloudSync: boolean;
  /** Vehicle sharing / Friends. */
  canShare: boolean;

  // — Support —
  prioritySupport: boolean;
}

/** Feature matrix per tier. The single source of truth for what each plan unlocks. */
export const TIER_FEATURES: Record<Tier, Entitlements> = {
  free: {
    tier: 'free',
    canRemoteView: true,
    remoteViewManualOnly: true,
    remoteRefreshMinIntervalSec: 180, // ~once every 3 min (the 2–5 min band)
    canRemoteControl: false,
    canAwayPush: false,
    canCloudFloodShutoff: false,
    automationLevel: 'none',
    canSmsAlert: false,
    telemetryResolutionSec: 1800, // worker persists ~every 30 min (cheap)
    historyRetentionDays: 0,
    canExport: false,
    canIntegrations: false,
    canCloudSync: true,
    canShare: true,
    prioritySupport: false,
  },
  basic: {
    tier: 'basic',
    canRemoteView: true,
    remoteViewManualOnly: false,
    remoteRefreshMinIntervalSec: 0,
    canRemoteControl: true,
    canAwayPush: true,
    canCloudFloodShutoff: true,
    automationLevel: 'essential',
    canSmsAlert: false,
    telemetryResolutionSec: 300, // ~every 5 min
    historyRetentionDays: 30, // ~1 month
    canExport: false,
    canIntegrations: false,
    canCloudSync: true,
    canShare: true,
    prioritySupport: false,
  },
  premium: {
    tier: 'premium',
    canRemoteView: true,
    remoteViewManualOnly: false,
    remoteRefreshMinIntervalSec: 0,
    canRemoteControl: true,
    canAwayPush: true,
    canCloudFloodShutoff: true,
    automationLevel: 'advanced',
    canSmsAlert: true,
    telemetryResolutionSec: 60, // ~every 1 min (high-res)
    historyRetentionDays: 1095, // ~3 years
    canExport: true,
    canIntegrations: true,
    canCloudSync: true,
    canShare: true,
    prioritySupport: true,
  },
};

/** True if `value` is a valid known tier string. */
export function isTier(value: unknown): value is Tier {
  return value === 'free' || value === 'basic' || value === 'premium';
}

/**
 * Resolve the tier of a vehicle from its cloud doc. Reads `vehicleData.tier`; falls back to
 * GRANDFATHERED_TIER for legacy/unset vehicles. Invalid stored values also fall back (defensive).
 *
 * NOTE: this does NOT evaluate the Basic free trial — trial state (and its per-user/per-vehicle
 * anti-abuse tracking) is resolved server-side and written into `tier` for the trial window. See
 * open-tasks Task 6 (trial).
 */
export function getVehicleTier(vehicleData: any): Tier {
  const stored = vehicleData?.tier;
  return isTier(stored) ? stored : GRANDFATHERED_TIER;
}

/** Resolve the full entitlement set for a vehicle. */
export function getEntitlements(vehicleData: any): Entitlements {
  return TIER_FEATURES[getVehicleTier(vehicleData)];
}

/** True if `tier` is at least `min` in the free→basic→premium ordering. */
export function tierAtLeast(tier: Tier, min: Tier): boolean {
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(min);
}

/** True if `level` is at least `min` in the none→essential→advanced ordering. */
export function automationAtLeast(level: AutomationLevel, min: AutomationLevel): boolean {
  return AUTOMATION_ORDER.indexOf(level) >= AUTOMATION_ORDER.indexOf(min);
}

/** Human-facing labels + prices for the pricing UI (Task 6 pricing-page rebuild). */
export const TIER_LABELS: Record<Tier, string> = {
  free: 'Free',
  basic: 'Basic',
  premium: 'Premium',
};
export const TIER_PRICING: Record<Tier, { monthly: number; yearly: number }> = {
  free: { monthly: 0, yearly: 0 },
  basic: { monthly: 3, yearly: 12 },
  premium: { monthly: 5, yearly: 30 },
};
