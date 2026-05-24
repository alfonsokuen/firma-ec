import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import sitemap from '@astrojs/sitemap';
import UnoCSS from '@unocss/astro';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  site: 'https://firmar.ec',
  output: 'static',
  compressHTML: true,
  // 'always' to match directory-format output served by Caddy. With 'never',
  // canonical/sitemap/hreflang emit slashless URLs that 308-redirect (SEO fix
  // 2026-05-23): self-referential canonicals + sitemap without redirects.
  trailingSlash: 'always',
  build: {
    inlineStylesheets: 'always',
    assets: '_astro',
    format: 'directory',
  },
  i18n: {
    defaultLocale: 'es',
    locales: ['es', 'en'],
    routing: { prefixDefaultLocale: false },
    // No fallback — pages/en/index.astro serves EN home; pages/en/*.astro have explicit EN content
  },
  integrations: [
    UnoCSS({ injectReset: '@styles/reset.css' }),
    svelte({ extensions: ['.svelte'] }),
    sitemap({
      i18n: {
        defaultLocale: 'es',
        locales: { es: 'es-EC', en: 'en-US' },
      },
      changefreq: 'weekly',
      priority: 0.7,
      lastmod: new Date(),
    }),
  ],
  vite: {
    resolve: {
      alias: {
        '@styles': fileURLToPath(new URL('./src/styles', import.meta.url)),
      },
    },
    build: {
      cssMinify: 'lightningcss',
      minify: 'esbuild',
      target: 'es2022',
    },
  },
});
