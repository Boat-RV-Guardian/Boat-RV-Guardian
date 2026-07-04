// Deterministic fake telemetry for DEMO mode (see demoMode.ts / demoFleet.ts).
//
// Every generator here is a PURE function of a timestamp `t` (epoch ms) — no Date.now / Math.random —
// so the demo animates smoothly (call each tick with the current time) AND is exactly testable (assert
// the value at a fixed `t`). The doc builders emit the SAME flat, string-valued shapes the cloud worker
// writes to Firestore `sensorState/*`, so the existing widgets consume them with zero UI changes:
//   - LinkTap valve  → mergeLinkTapSensorDoc() in linktapCloudState.ts
//   - Shelly sensors → the onSnapshot reader in ShellyWidget.tsx ({v,vraw,tC,batt,event,at})

const TAU = Math.PI * 2;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Smooth deterministic oscillation: `amp · sin(2π·t/period + phase)`. */
export function wobble(t: number, periodMs: number, amp: number, phase = 0): number {
  return amp * Math.sin((TAU * t) / periodMs + phase);
}

/** A 0..1 diurnal curve peaking once per day (a stand-in for a solar / temperature day cycle). */
function diurnal(t: number): number {
  return (Math.sin((TAU * (t % DAY)) / DAY - Math.PI / 2) + 1) / 2;
}

const round = (n: number, dp = 2): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

// ── LinkTap valve ────────────────────────────────────────────────────────────
// A believable "wash-down" schedule: a watering burst at the top of each cycle, idle otherwise. Kept
// short so a demo visitor sees the valve open, flow, and close within a minute rather than waiting.
export const DEMO_VALVE_CYCLE_MS = 60_000;
export const DEMO_VALVE_WATER_MS = 18_000; // 18s of flow per 60s cycle

/** Is the demo valve open at `t`? */
export function demoValveWatering(t: number): boolean {
  return t % DEMO_VALVE_CYCLE_MS < DEMO_VALVE_WATER_MS;
}

/** Flow in L/min (boats run wide open) — 0 when the valve is closed, ~7.5 with slight variation when open. */
export function demoValveFlow(t: number): number {
  if (!demoValveWatering(t)) return 0;
  return round(Math.max(0, 7.5 + wobble(t, 11_000, 0.6)), 1);
}

/** Valve battery %, a slow deterministic sag in a believable 93–99 band. */
export function demoValveBattery(t: number): number {
  return Math.round(96 + wobble(t, 6 * HOUR, 3));
}

/** RF signal % the LinkTap gateway reports (0..100). */
export function demoSignal(t: number): number {
  return Math.round(72 + wobble(t, 20 * MIN, 8));
}

// ── Scripted flood incident ──────────────────────────────────────────────────
// Once per scenario cycle the bilge flood sensor alarms for a short window, which auto-closes the
// valve (safety shutoff) and logs an alert — the app's core burst-pipe story, on a loop. The window
// is offset from the valve's wash-down so the "flood → valve was open, now forced closed" reads clearly.
export const DEMO_SCENARIO_CYCLE_MS = 3 * MIN;
export const DEMO_FLOOD_START_MS = 90_000;    // 1:30 into each cycle
export const DEMO_FLOOD_DURATION_MS = 20_000; // 20s alarm

/** Is the scripted bilge flood alarm active at `t`? */
export function demoFloodAlarmActive(t: number): boolean {
  const phase = t % DEMO_SCENARIO_CYCLE_MS;
  return phase >= DEMO_FLOOD_START_MS && phase < DEMO_FLOOD_START_MS + DEMO_FLOOD_DURATION_MS;
}

/** A full LinkTap valve `sensorState` doc for time `t`, as the worker would write it. */
export function demoLinkTapDoc(t: number): Record<string, string> {
  const flood = demoFloodAlarmActive(t);
  // A flood forces the valve shut regardless of the wash-down schedule (the safety net).
  const watering = !flood && demoValveWatering(t);
  return {
    event: flood ? 'water cut-off alert' : (watering ? 'flowMeterValue' : 'wateringOff'),
    at: String(t),
    watering: watering ? '1' : '0',
    flow: String(watering ? demoValveFlow(t) : 0),
    battery: String(demoValveBattery(t)),
    signal: String(demoSignal(t)),
    workMode: 'M',
    ...(flood ? { alarm: 'floodShutoff', kind: 'alarm' } : { kind: watering ? 'telemetry' : 'watering' }),
  };
}

// ── Shelly sensors ───────────────────────────────────────────────────────────
export type DemoSensorKind = 'shore' | 'battery' | 'flood' | 'thermo';

export interface DemoSensorSpec {
  deviceId: string;
  kind: DemoSensorKind;
  /** Nominal value: volts (shore/battery) or °C (thermo). Ignored for flood. */
  base: number;
  /** Adds a diurnal charge bump — used for the house/solar battery so it climbs midday. */
  solar?: boolean;
  /** Battery only: also emit a temperature (°C nominal) so the widget shows a 🌡️ badge, like a real Uni. */
  tempBaseC?: number;
}

/** Voltage (V) for a shore-power or battery sensor at `t`. */
export function demoVoltage(spec: DemoSensorSpec, t: number): number {
  if (spec.kind === 'shore') {
    // 120V mains with a slow swell plus a little line ripple.
    return round(spec.base + wobble(t, 8 * MIN, 1.2) + wobble(t, 47_000, 0.3));
  }
  // Battery: a small ripple; the solar bank also climbs ~0.8V toward midday, then settles.
  const solar = spec.solar ? 0.8 * diurnal(t) : 0;
  return round(spec.base + solar + wobble(t, 12 * MIN, 0.05));
}

/** Temperature (°C) for a temp/humidity sensor at `t` — a gentle day/night swing around `base`. */
export function demoTempC(spec: DemoSensorSpec, t: number): number {
  return round(spec.base + 4 * (diurnal(t) - 0.5) + wobble(t, 9 * MIN, 0.2), 1);
}

/**
 * A full Shelly `sensorState` doc for `spec` at `t`. Pass `alarmActive` for the flood sensor to script
 * a leak (increment 3 drives this); it defaults to dry.
 */
export function demoShellyDoc(spec: DemoSensorSpec, t: number, alarmActive = false): Record<string, string> {
  const base: Record<string, string> = { at: String(t) };
  switch (spec.kind) {
    case 'shore': {
      const v = demoVoltage(spec, t);
      return { ...base, event: 'pm1.voltage_change', v: String(v), vraw: String(v) };
    }
    case 'battery': {
      const v = demoVoltage(spec, t);
      // Voltmeter reports raw + corrected; the demo applies no offset, so they match.
      const doc: Record<string, string> = { ...base, event: 'voltmeter.change', v: String(v), vraw: String(v) };
      // A Shelly Uni's voltmeter install often also reports temperature — surface it when configured.
      if (spec.tempBaseC != null) doc.tC = String(demoTempC({ ...spec, base: spec.tempBaseC }, t));
      return doc;
    }
    case 'thermo':
      return { ...base, event: 'temperature.change', tC: String(demoTempC(spec, t)), batt: '100' };
    case 'flood':
      return {
        ...base,
        event: alarmActive ? 'flood.alarm on' : 'flood.alarm inactive',
        batt: '100',
      };
  }
}

// ── Seeded history (for charts / sparklines) ─────────────────────────────────
/**
 * Sample a numeric generator backward from `endT` to produce `points` readings spaced `stepMs` apart,
 * oldest first. Deterministic — the same (fn, endT, points, stepMs) always yields the same series.
 */
export function sampleBack(fn: (t: number) => number, endT: number, points: number, stepMs: number): Array<{ t: number; value: number }> {
  const out: Array<{ t: number; value: number }> = [];
  for (let i = points - 1; i >= 0; i--) {
    const t = endT - i * stepMs;
    out.push({ t, value: fn(t) });
  }
  return out;
}
