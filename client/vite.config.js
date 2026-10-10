import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Content-Security-Policy for the production build. It is injected only at
// build time so the Vite dev server (inline HMR scripts) keeps working.
// frame-ancestors can't be set from a <meta> tag; it is sent as a header by
// public/_headers (Netlify / Cloudflare Pages) or vercel.json (Vercel).
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-src 'self' blob: https://*.supabase.co; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'"

const securityMeta = () => ({
  name: 'security-meta',
  apply: 'build',
  transformIndexHtml(html) {
    return html.replace(
      '<head>',
      `<head>
    <meta http-equiv="Content-Security-Policy" content="${CSP}">
    <meta name="referrer" content="strict-origin-when-cross-origin">`,
    )
  },
})

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    securityMeta(),
    VitePWA({
      registerType: 'autoUpdate',
      // External registerSW.js (no inline script) so the strict CSP still passes.
      injectRegister: 'script',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'PHILAM Life - Homeowners Ledger System',
        short_name: 'PHILAM Life',
        description: 'PHILAM Village HOA management system',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#e6f0fa',
        theme_color: '#1464a0',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cache only the app shell (JS/CSS/icons). Supabase data and auth calls
        // are never cached, so records and balances are always live.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  // Production builds: no console output or debugger statements.
  esbuild: mode === 'production' ? { drop: ['console', 'debugger'] } : {},
  server: {
    port: 5173,
    host: 'localhost',
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  },
}))