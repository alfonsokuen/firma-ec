import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

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
      '@firma-ec/tsl-ec': resolve(__dirname, 'packages/tsl-ec/src/index.ts'),
      '@firma-ec/crypto-core': resolve(__dirname, 'packages/crypto-core/src/index.ts'),
      '@firma-ec/tsa-client': resolve(__dirname, 'packages/tsa-client/src/index.ts'),
      '@firma-ec/tsa-trust': resolve(__dirname, 'packages/tsa-trust/src/index.ts'),
      '@firma-ec/pdf-sign': resolve(__dirname, 'packages/pdf-sign/src/index.ts'),
      '@firma-ec/dss-pdf': resolve(__dirname, 'packages/dss-pdf/src/index.ts'),
      '@firma-ec/ltv-validation': resolve(__dirname, 'packages/ltv-validation/src/index.ts'),
      '@firma-ec/verifier': resolve(__dirname, 'packages/verifier/src/index.ts'),
      '@firma-ec/signer': resolve(__dirname, 'packages/signer/src/index.ts'),
      '@firma-ec/inbox-crypto': resolve(__dirname, 'packages/inbox-crypto/src/index.ts'),
      '@firma-ec/ui-kit': resolve(__dirname, 'packages/ui-kit/src/index.ts'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['**/*.{test,spec}.{ts,js}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.astro/**',
      '**/e2e/**',
      // Svelte 5 rune modules (`*.svelte.ts`) need `@sveltejs/vite-plugin-svelte`
      // to compile `$state`/`$derived` — this shared root config stays
      // framework-agnostic (every other package here is plain TS), so specs
      // that import a rune module run instead via the package-local config:
      //   pnpm --filter @firma-ec/pwa exec vitest run
      // See apps/pwa/vitest.config.ts for the rationale.
      'apps/pwa/src/lib/guiado/voice.test.ts',
      'apps/pwa/src/lib/swUpdate.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.config.{ts,js,mjs}',
        '**/tests/**',
        '**/types/**',
        '**/.astro/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
    reporters: ['default'],
  },
});
