import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://firmar.ec',
  output: 'static',
  compressHTML: true,
  build: {
    inlineStylesheets: 'always',
    assets: '_astro',
  },
  vite: {
    build: {
      cssMinify: 'lightningcss',
      minify: 'esbuild',
      target: 'es2022',
    },
  },
});
