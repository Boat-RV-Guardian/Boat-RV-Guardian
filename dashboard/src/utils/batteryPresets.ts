// Battery voltage presets by chemistry, for 12 V and 24 V systems (24 V ≈ 2× the 12 V figures).
// Values are marine/RV norms: crit = near-empty alarm, low = recharge warning, normal = resting-full
// nominal, charge = "charging detected" threshold, over = over-voltage alarm. 'custom' applies no
// preset — the fields stay manually editable.
//
// Extracted from Settings.tsx (Task 3 split) so the preset table + lookup are pure and testable.

export type BattThresholds = { crit: number; low: number; normal: number; charge: number; over: number };

export type SystemVoltage = '12' | '24';

export const BATTERY_PRESETS: Record<string, { label: string; v: Record<SystemVoltage, BattThresholds> }> = {
  flooded: {
    label: 'Flooded Lead-Acid',
    v: {
      '12': { crit: 11.8, low: 12.2, normal: 12.6, charge: 13.6, over: 15.0 },
      '24': { crit: 23.6, low: 24.4, normal: 25.2, charge: 27.2, over: 30.0 },
    },
  },
  agm: {
    label: 'AGM (Sealed)',
    v: {
      '12': { crit: 11.8, low: 12.0, normal: 12.8, charge: 13.6, over: 14.7 },
      '24': { crit: 23.6, low: 24.0, normal: 25.6, charge: 27.2, over: 29.4 },
    },
  },
  gel: {
    label: 'Gel',
    v: {
      '12': { crit: 11.8, low: 12.0, normal: 12.8, charge: 13.5, over: 14.2 },
      '24': { crit: 23.6, low: 24.0, normal: 25.6, charge: 27.0, over: 28.4 },
    },
  },
  lifepo4: {
    label: 'Lithium (LiFePO₄)',
    v: {
      '12': { crit: 12.0, low: 12.8, normal: 13.2, charge: 13.8, over: 14.6 },
      '24': { crit: 24.0, low: 25.6, normal: 26.4, charge: 27.6, over: 29.2 },
    },
  },
  custom: {
    label: 'Custom (manual)',
    v: {
      '12': { crit: 11.8, low: 12.2, normal: 12.6, charge: 13.6, over: 15.0 },
      '24': { crit: 23.6, low: 24.4, normal: 25.2, charge: 27.2, over: 30.0 },
    },
  },
};

// The preset thresholds to apply for a chemistry + system voltage, or null when no preset should be
// applied (the 'custom' chemistry, or an unknown type/voltage) — in which case the caller leaves the
// existing manual values untouched.
export function getBatteryThresholds(type: string, sysV: string): BattThresholds | null {
  if (type === 'custom') return null;
  return BATTERY_PRESETS[type]?.v[sysV as SystemVoltage] ?? null;
}
