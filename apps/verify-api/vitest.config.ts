import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Handle Vite's `?raw` suffix in Node (PEM trust anchors in tsl-ec/tsa-trust). */
function rawAssetPlugin(): Plugin {
  return {
    name: 'raw-asset',
    load(id: string) {
      if (!id.endsWith('?raw')) return undefined;
      const filePath = resolve(id.slice(0, -4));
      return `export default ${JSON.stringify(readFileSync(filePath, 'utf-8'))};`;
    },
  };
}

export default defineConfig({
  plugins: [rawAssetPlugin()],
  resolve: {
    alias: {
      '@firma-ec/verifier': resolve(__dirname, '../../packages/verifier/src/index.ts'),
      '@firma-ec/crypto-core': resolve(__dirname, '../../packages/crypto-core/src/index.ts'),
      '@firma-ec/tsl-ec': resolve(__dirname, '../../packages/tsl-ec/src/index.ts'),
      '@firma-ec/tsa-client': resolve(__dirname, '../../packages/tsa-client/src/index.ts'),
      '@firma-ec/tsa-trust': resolve(__dirname, '../../packages/tsa-trust/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
