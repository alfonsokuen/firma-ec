import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

/**
 * Package-local Vitest config for @firma-ec/pwa.
 *
 * Why this exists (and why it's separate from the shared root
 * `vitest.config.ts`): unit tests that import a Svelte 5 rune module
 * (`*.svelte.ts`, e.g. `voice.svelte.ts`, `settings.svelte.ts`) need the
 * `$state`/`$derived` runes compiled by `@sveltejs/vite-plugin-svelte` —
 * without it, `$state(...)` throws `ReferenceError: $state is not defined`
 * at import time. The root config intentionally stays framework-agnostic
 * (it's shared by every package in the monorepo, most of which are plain
 * TS), so it does not carry Svelte/vite-plugin-svelte as a dependency.
 * Adding those here — scoped to `apps/pwa`, where `svelte` and
 * `@sveltejs/vite-plugin-svelte` are already real dependencies — avoids
 * expanding the root's dependency surface for a single package's need.
 *
 * Root `pnpm test` (CI) does NOT auto-discover this file — Vitest resolves
 * one config for the whole invocation, based on cwd. Any spec that needs
 * this config must be excluded from the root config's `include`/`exclude`
 * (see `vitest.config.ts` at the repo root) and run instead via:
 *   pnpm --filter @firma-ec/pwa exec vitest run
 */
export default defineConfig({
  plugins: [svelte()],
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,js}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
  },
});
