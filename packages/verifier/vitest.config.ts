import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Plugin to handle Vite's `?raw` suffix in Vitest (Node environment).
 * Reads the file as UTF-8 text and returns it as a default export string.
 * Required for @firma-ec/tsl-ec/src/roots.ts which imports PEM files with `?raw`.
 */
function rawAssetPlugin(): Plugin {
  return {
    name: 'raw-asset',
    load(id: string) {
      if (!id.endsWith('?raw')) return undefined;
      const filePath = resolve(id.slice(0, -4)); // strip `?raw`
      const content = readFileSync(filePath, 'utf-8');
      return `export default ${JSON.stringify(content)};`;
    },
  };
}

export default defineConfig({
  plugins: [rawAssetPlugin()],
  resolve: {
    alias: {
      // Resolve workspace packages via their source TypeScript files
      // (the `main` field points to .ts but Vite needs explicit resolution)
      '@firma-ec/tsl-ec': resolve(__dirname, '../tsl-ec/src/index.ts'),
      '@firma-ec/crypto-core': resolve(__dirname, '../crypto-core/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
