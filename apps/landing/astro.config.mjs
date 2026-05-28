import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import sitemap from '@astrojs/sitemap';
import UnoCSS from '@unocss/astro';
import { fileURLToPath, URL } from 'node:url';
import { ROUTE_MAP } from './src/i18n/utils.ts';

// Sitemap hreflang: @astrojs/sitemap's i18n option only pairs URLs with the
// same slug modulo the locale segment (e.g. /faq/ ↔ /en/faq/). Our EN slugs are
// translated (/seguridad/ ↔ /en/security/), so those pairs never auto-link.
// This serialize hook attaches the correct xhtml:link alternates per URL using
// ROUTE_MAP (the single source of ES↔EN route pairs). In-page <link hreflang>
// were already correct; this reinforces them at the sitemap level.
const SITE = 'https://firmar.ec';
const stripSlash = (p) => p.replace(/\/+$/, '') || '/';
const ROUTE_PAIRS = Object.values(ROUTE_MAP);
const pairForPath = (pathname) => {
  const n = stripSlash(pathname);
  return ROUTE_PAIRS.find((m) => stripSlash(m.es) === n || stripSlash(m.en) === n) ?? null;
};

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
      serialize(item) {
        const pair = pairForPath(new URL(item.url).pathname);
        if (pair) {
          item.links = [
            { lang: 'es-EC', url: SITE + pair.es },
            { lang: 'en-US', url: SITE + pair.en },
            { lang: 'x-default', url: SITE + pair.es },
          ];
        }
        return item;
      },
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
