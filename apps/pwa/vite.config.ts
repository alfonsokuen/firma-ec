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
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,png}'],
        navigateFallback: '/index.html',
        // SECURITY: crypto and signing routes must always be fresh — never serve stale SW cache
        navigateFallbackDenylist: [
          /^\/verificar/,
          /^\/firmar/,
          /^\/paranoia/,
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
