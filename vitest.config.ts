import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['**/*.{test,spec}.{ts,js}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.astro/**', '**/e2e/**'],
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
