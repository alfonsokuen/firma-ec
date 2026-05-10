import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Mirrors verifier's vitest config: handle Vite's `?raw` suffix in Node tests. */
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
      '@firma-ec/tsa-client': resolve(__dirname, '../tsa-client/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
