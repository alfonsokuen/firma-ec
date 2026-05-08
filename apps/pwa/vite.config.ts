import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'firma.ec',
        short_name: 'firma.ec',
        description: 'Firma y verifica PDFs con tu certificado ecuatoriano. 100% en tu navegador.',
        theme_color: '#0B1A3A',
        background_color: '#0B1A3A',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        lang: 'es',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/firmar/, /^\/verificar/],
      },
    }),
  ],
  build: {
    target: 'es2022',
    cssMinify: 'lightningcss',
    minify: 'esbuild',
    sourcemap: true,
    rollupOptions: {
      output: { manualChunks: undefined },
    },
  },
  server: { port: 5173, strictPort: true },
});
