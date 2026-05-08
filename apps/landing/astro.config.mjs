import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import sitemap from '@astrojs/sitemap';
import UnoCSS from '@unocss/astro';

export default defineConfig({
  site: 'https://firmar.ec',
  output: 'static',
  compressHTML: true,
  trailingSlash: 'never',
  build: {
    inlineStylesheets: 'always',
    assets: '_astro',
    format: 'directory',
  },
  i18n: {
    defaultLocale: 'es',
    locales: ['es', 'en'],
    routing: { prefixDefaultLocale: false },
    fallback: { en: 'es' },
  },
  integrations: [
    UnoCSS({ injectReset: 'src/styles/reset.css' }),
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
    build: {
      cssMinify: 'lightningcss',
      minify: 'esbuild',
      target: 'es2022',
    },
  },
});
