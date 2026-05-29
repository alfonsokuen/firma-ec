import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Handle Vite's `?raw` suffix in Node (needed for @firma-ec/tsl-ec PEM imports). */
function rawAssetPlugin(): Plugin {
  return {
    name: 'raw-asset',
    load(id: string) {
      if (!id.endsWith('?raw')) return undefined;
      const filePath = resolve(id.slice(0, -4));
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
      // (the `main` field points to .ts but Vite needs explicit resolution).
      '@firma-ec/crypto-core': resolve(__dirname, '../crypto-core/src/index.ts'),
      '@firma-ec/verifier': resolve(__dirname, '../verifier/src/index.ts'),
      '@firma-ec/tsl-ec': resolve(__dirname, '../tsl-ec/src/index.ts'),
      '@firma-ec/tsa-client': resolve(__dirname, '../tsa-client/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
