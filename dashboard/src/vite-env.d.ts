/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Build-time constant injected by vite.config.ts `define`. True only for the web (Cloudflare Pages)
// build, which ships a real PWA service worker; false for native (Tauri/Capacitor) builds.
declare const __WEB_PWA__: boolean

// Build-time constant injected by vite.config.ts `define`. True only for `vite build --mode demo`
// (the demo.boatrvguardian.com no-login showcase). `if (__DEMO__)` branches + the demo fleet /
// telemetry modules are dead-code-eliminated from every other build.
declare const __DEMO__: boolean
