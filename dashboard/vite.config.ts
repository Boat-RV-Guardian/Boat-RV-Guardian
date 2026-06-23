import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Build target switch. The web build (Cloudflare Pages) sets BRVG_TARGET=web and gets a real PWA
// service worker for offline + installability. Every other build (Tauri desktop, Capacitor Android)
// is native: a service worker is HARMFUL there — assets are already served locally and the SW's
// precache served STALE chunks across app updates (new dynamic imports like shellyBle 404'd against
// an old cached index.html). Native therefore ships a self-destroying worker that unregisters any
// previously-installed SW and clears its caches, then removes itself.
const isWeb = process.env.BRVG_TARGET === 'web'

export default defineConfig({
  plugins: [
    react(),
    VitePWA(
      isWeb
        ? {
            registerType: 'autoUpdate',
            includeAssets: ['favicon.svg', 'app_icon_192.png', 'app_icon_512.png'],
            manifest: {
              name: 'Boat & RV Guardian',
              short_name: 'Guardian',
              description: 'Burst-pipe auto-shutoff and sensor monitoring for boats and RVs.',
              theme_color: '#0d1527',
              background_color: '#0a0f1d',
              display: 'standalone',
              orientation: 'portrait',
              start_url: '/',
              scope: '/',
              icons: [
                { src: 'app_icon_192.png', sizes: '192x192', type: 'image/png' },
                { src: 'app_icon_512.png', sizes: '512x512', type: 'image/png' },
                { src: 'app_icon_512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
              ],
            },
            workbox: {
              navigateFallback: 'index.html',
              globPatterns: ['**/*.{js,css,html,svg,png,jpg,ico,webmanifest}'],
              cleanupOutdatedCaches: true,
              // Don't let the SW serve the app shell for API navigations — only real app routes.
              navigateFallbackDenylist: [/^\/api\//],
            },
          }
        : { selfDestroying: true }
    ),
  ],
  // Native loads assets over file:// (relative), web is served from the domain root (absolute).
  base: isWeb ? '/' : './',
  define: {
    __WEB_PWA__: JSON.stringify(isWeb),
  },
  build: {
    outDir: 'dist',
  },
})
