// Per-vehicle subscription entitlements (open-tasks Task 6).
//
// Decisions (2026-06-25): entitlements attach PER-VEHICLE (the vehicle carries the tier; everyone
// who accesses it — owner + shared monitors — gets that vehicle's features). Billing is scaffolded
// now and provider-agnostic; Stripe drops in later. This module is PURE (no I/O) so it's trivially
// testable and reusable on the worker for server-side enforcement.
//
// Tier model:
//   free    — monitor vehicles (VIEW only, no control) + cloud settings sync/backup + sharing.
//   basic   — adds control (hosted actions/triggers/timers) + ~1 month hosted history.
//   premium — adds long history (up to 3 years) + SMS/voice alerts + priority support.

export type Tier = 'free' | 'basic' | 'premium';

/** Tiers low→high. Used by `tierAtLeast`. */
export const TIER_ORDER: readonly Tier[] = ['free', 'basic', 'premium'] as const;

/**
 * The tier assumed for a vehicle that has no `tier` field yet (legacy / pre-billing vehicles).
 * Set to `premium` so the entitlement layer can ship WITHOUT changing behavior for anyone — existing
 * single-user owners keep full control. Once the admin "set tier" switch / Stripe assigns real
 * tiers, stored values take over. Do NOT lower this default to 'free' until billing + the admin
 * override exist, or every current user instantly loses control of their own boat.
 */
export const GRANDFATHERED_TIER: Tier = 'premium';

export interface Entitlements {
  tier: Tier;
  /** Send valve/device commands (user-initiated control). Free is view-only. */
  canControl: boolean;
  /** Hosted actions/triggers/timers run in the cloud worker (vs local-only). */
  canCloudActions: boolean;
  /** Cloud settings/config sync + backup (free — needed so a shared monitor's devices match). */
  canCloudSync: boolean;
  /** Vehicle sharing / Friends (free). */
  canShare: boolean;
  /** Days of HOSTED history retained (0 = no hosted history; on-device history is separate). */
  historyRetentionDays: number;
  /** SMS / voice (call) alerts on specific events (premium). */
  canSmsAlert: boolean;
  /** Priority / premium support (premium). */
  prioritySupport: boolean;
}

/** Feature matrix per tier. The single source of truth for what each plan unlocks. */
export const TIER_FEATURES: Record<Tier, Entitlements> = {
  free: {
    tier: 'free',
    canControl: false,
    canCloudActions: false,
    canCloudSync: true,
    canShare: true,
    historyRetentionDays: 0,
    canSmsAlert: false,
    prioritySupport: false,
  },
  basic: {
    tier: 'basic',
    canControl: true,
    canCloudActions: true,
    canCloudSync: true,
    canShare: true,
    historyRetentionDays: 30, // ~1 month
    canSmsAlert: false,
    prioritySupport: false,
  },
  premium: {
    tier: 'premium',
    canControl: true,
    canCloudActions: true,
    canCloudSync: true,
    canShare: true,
    historyRetentionDays: 1095, // ~3 years
    canSmsAlert: true,
    prioritySupport: true,
  },
};

/** True if `tier` is a valid known tier string. */
export function isTier(value: unknown): value is Tier {
  return value === 'free' || value === 'basic' || value === 'premium';
}

/**
 * Resolve the tier of a vehicle from its cloud doc. Reads `vehicleData.tier`; falls back to
 * GRANDFATHERED_TIER for legacy/unset vehicles. Invalid stored values also fall back (defensive).
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
