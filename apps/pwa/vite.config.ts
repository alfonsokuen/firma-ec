import { svelte } from '@sveltejs/vite-plugin-svelte';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import UnoCSS from 'unocss/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Read the TSL SHA-256 baked in at build time for the runtime SRI check.
// Falls back to empty string in dev mode (before build:tsl has run).
const tslShaPath = resolve(import.meta.dirname, 'public/trust/tsl-ec.sha256');
const TSL_HASH = existsSync(tslShaPath) ? readFileSync(tslShaPath, 'utf-8').trim() : '';

export default defineConfig({
  define: {
    __TSL_HASH__: JSON.stringify(TSL_HASH),
  },
  plugins: [
    // UnoCSS must come before Svelte so atomic classes are generated before component compilation
    UnoCSS(),
    svelte(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'fonts/*.woff2'],
      manifest: {
        name: 'firmar.ec — Firma y Verifica PDFs',
        short_name: 'firmar.ec',
        description:
          'Firma y verifica PDFs con tu certificado ecuatoriano. 100% en tu navegador, sin servidores.',
        theme_color: '#0B1A3A',
        background_color: '#0B1A3A',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        lang: 'es',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        // v0.4.0 — receive PDFs from WhatsApp/Gmail/etc via OS share sheet.
        // POST + multipart will only deliver files when a SW intercepts /share
        // (deferred to v0.4.1). The declaration is kept now so the OS lists
        // firmar.ec as a target; until the SW lands, file shares hit the server
        // (gracefully redirected to / by Caddy try_files). text/url shares work.
        share_target: {
          action: '/share',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [
              { name: 'file', accept: ['application/pdf', '.pdf'] },
            ],
          },
        },
        // v0.4.0 — register as "Open with" target for PDFs. This uses the
        // browser launchQueue API (Chromium 102+ on Android/Desktop) and does
        // NOT require a service worker — the file arrives in the launchQueue
        // consumer at /handle-file and is read from a FileSystemHandle.
        file_handlers: [
          {
            action: '/handle-file',
            accept: { 'application/pdf': ['.pdf'] },
            icons: [
              { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            ],
            launch_type: 'single-client',
          },
        ],
        // Reuse an existing tab if the PWA is already open when shared/launched.
        launch_handler: { client_mode: 'navigate-existing' },
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,png}'],
        navigateFallback: '/index.html',
        // SECURITY: crypto and signing routes must always be fresh — never serve stale SW cache
        navigateFallbackDenylist: [
          /^\/verificar/,
          /^\/firmar/,
          /^\/paranoia/,
          // v0.4.0 — share/handle-file should never be served from precache;
          // they need server response (and in v0.4.1 a SW intercept for POST).
          /^\/share/,
          /^\/handle-file/,
        ],
        runtimeCaching: [
          {
            // Crypto chunks: always network-only — stale crypto code is a security risk
            urlPattern: /\/_assets\/crypto-/,
            handler: 'NetworkOnly',
          },
          {
            // TSL trust list: always fresh — stale list may miss revoked certificates
            urlPattern: /\/trust\/tsl-ec\.json$/,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  worker: {
    // Worker is instantiated with `{ type: 'module' }` (see src/lib/workers/bus.ts).
    // Vite's default worker.format='iife' is incompatible with code-splitting builds
    // (chunked workers). ES output matches the runtime declaration.
    format: 'es',
  },
  build: {
    target: 'es2022',
    cssMinify: 'lightningcss',
    minify: 'esbuild',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Crypto core — grouped for NetworkOnly SW policy + cache-busting by hash
          // TODO(Task4-7): pkijs, asn1js, @noble/hashes, @noble/curves not yet installed
          // Uncomment when crypto deps land:
          // if (
          //   id.includes('pkijs') ||
          //   id.includes('asn1js') ||
          //   id.includes('@noble/hashes') ||
          //   id.includes('@noble/curves')
          // ) {
          //   return 'crypto-core';
          // }

          // PDF processing — separate chunk for lazy loading on verify route
          // TODO(Task5): pdf-lib not yet installed
          // Uncomment when pdf-lib lands:
          // if (id.includes('pdf-lib')) {
          //   return 'pdf';
          // }

          // Prevent accidental bundle of unused forward-looking deps returning undefined
          return undefined;
        },
      },
    },
  },
  server: { port: 5173, strictPort: true },
});
