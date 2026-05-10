import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
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
