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
  },
});
