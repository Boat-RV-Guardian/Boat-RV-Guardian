import { defineConfig } from 'vitest/config';

// Standalone test config — deliberately does NOT pull in the app's Vite plugins (React/PWA).
// The unit tests target framework-free utility modules, so a plain jsdom environment (which gives
// us localStorage / window / crypto.subtle) is all we need and keeps the run fast.
export default defineConfig({
  test: {
    environment: 'jsdom',
    // A concrete origin (not the default about:blank) gives jsdom a non-opaque origin, without
    // which window.localStorage is unavailable and the storage-backed utils can't be tested.
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    clearMocks: true,
    restoreMocks: true,
    // Coverage as a REGRESSION GUARD (open-tasks Task 9). utils/ + hooks/ still contain a lot of
    // legitimately untested IO/device code (VehicleManager, shellyBle, localServer, nativeFetch), so
    // these are deliberately CONSERVATIVE global floors a few points below the current baseline
    // (~59% lines / 57% branch / 56% funcs) — enough headroom for normal churn, but a meaningful
    // coverage drop fails CI. Raise them (or add per-module thresholds) as the IO modules gain tests.
    // Enforced in CI via `npm run test:coverage`.
    coverage: {
      provider: 'v8',
      thresholds: { lines: 55, statements: 55, branches: 50, functions: 50 },
    },
  },
});
