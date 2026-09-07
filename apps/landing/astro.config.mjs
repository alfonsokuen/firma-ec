import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import sitemap from '@astrojs/sitemap';
import UnoCSS from '@unocss/astro';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { appVersionDefine } from '../pwa/appVersion.ts';
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

// `lastmod` HONESTO por pagina.
//
// Antes se emitia `lastmod: new Date()`: el sello del BUILD, identico en las 68
// URLs y contradiciendo el `dateModified` de las propias paginas. Un `lastmod`
// uniforme es una senal falsa — Google la detecta, deja de fiarse del sitemap y
// degrada la programacion de rastreo justo de lo que SI cambia. Medido el
// 2026-08-24: 68/68 URLs con la misma marca de tiempo.
//
// Ahora la fecha sale del frontmatter de cada pagina: `dateModified`, o
// `datePublished` si nunca se modifico (que es exactamente lo mismo). Una pagina
// SIN fecha declarada no recibe `lastmod`: omitirlo es honesto, inventarlo no.
const readDate = (file) => {
  try {
    const head = readFileSync(new URL(file, import.meta.url), 'utf8').slice(0, 1200);
    const mod = head.match(/^\s*dateModified\s*:\s*["']?(\d{4}-\d{2}-\d{2})/m);
    if (mod) return mod[1];
    const pub = head.match(/^\s*datePublished\s*:\s*["']?(\d{4}-\d{2}-\d{2})/m);
    return pub ? pub[1] : null;
  } catch {
    return null;
  }
};
const LASTMOD = {};
for (const [key, pair] of Object.entries(ROUTE_MAP)) {
  const es = readDate(`./src/content/pages/es/${key}.md`);
  if (es) LASTMOD[stripSlash(pair.es)] = es;
  const enStem = stripSlash(pair.en).split('/').pop();
  const en = readDate(`./src/content/pages/en/${enStem}.md`);
  if (en) LASTMOD[stripSlash(pair.en)] = en;
}

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
      serialize(item) {
        const path = new URL(item.url).pathname;
        const real = LASTMOD[stripSlash(path)];
        if (real) item.lastmod = real;
        else delete item.lastmod;
        const pair = pairForPath(path);
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
    // `softwareVersion` del JSON-LD sale de apps/pwa/package.json, la misma
    // fuente que el pie de la app. Estaba escrito a mano y se quedó en 0.9.14
    // mientras la PWA iba por 0.25.x: el dato que leen buscadores e IA decía
    // una versión que no existía desde hacía meses.
    define: appVersionDefine(),
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
