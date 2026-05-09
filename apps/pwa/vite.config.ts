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
      // v0.4.1 — switched from generateSW (Workbox auto) to injectManifest so
      // the custom sw.ts can intercept POST /share (Share Target). The
      // generated SW lives at /sw.js post-build (Vite bundles src/sw.ts).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        rollupFormat: 'es',
        // Bump from default 2MB — pdfjs/crypto chunks can exceed that.
        maximumFileSizeToCacheInBytes: 5_000_000,
        globPatterns: ['**/*.{js,css,html,svg,woff2,png}'],
      },
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
      // workbox: { ... }  — moved into src/sw.ts as part of v0.4.1 migration to
      // injectManifest. NetworkOnly rules for /_assets/crypto-* and /trust/*
      // and precache navigation are all expressed declaratively in sw.ts.
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
        // v0.4.6 — code-split heavy crypto deps so /firmar lands ~500KB instead
        // of pulling node-forge + pkijs + qrcode into the main entry chunk.
        // Grouped by load boundary: signer-deps (forge + qrcode) and pki
        // (pkijs/asn1js — also used by verifier). pdf for pdfjs-dist.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('node-forge') || id.includes('qrcode')) return 'signer-deps';
            if (id.includes('pdfjs-dist')) return 'pdf';
            if (id.includes('pkijs') || id.includes('asn1js')) return 'pki';
            if (id.includes('@noble') || id.includes('pvutils') || id.includes('pvtsutils')) return 'crypto-utils';
          }
          if (id.includes('packages/signer/src')) return 'signer';
          if (id.includes('packages/verifier/src')) return 'verifier';
          return undefined;
        },
      },
    },
  },
  server: { port: 5173, strictPort: true },
});
