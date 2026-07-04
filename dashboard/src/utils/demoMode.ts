// Build-time DEMO flag for the public no-login showcase (demo.boatrvguardian.com).
//
// The demo build feeds the real widgets a set of *fake* sensors + valve (see demoFleet.ts /
// demoTelemetry.ts) so prospective users can explore the app before buying or installing anything —
// no auth, no hardware, controls animate but change nothing real.
//
// Gating is by Vite mode: `vite build --mode demo` (or `vite --mode demo`) loads `.env.demo`, which
// sets `VITE_DEMO=1`. Vite statically inlines `import.meta.env.VITE_DEMO` at build time, so in every
// normal build the constant is `undefined` and `isDemoMode()` folds to `false` — the demo fleet and
// its generators are then dead-code-eliminated from the production web app and the native apps. The
// real apps never ship mock mode.

/** True only in a build produced with `--mode demo` (VITE_DEMO=1). Constant-folds to false otherwise. */
export function isDemoMode(): boolean {
  return import.meta.env.VITE_DEMO === '1';
}
