/**
 * Type declarations for Vite's `?raw` import suffix.
 * Vite (and vitest with the asset transform) resolves `?raw` imports as string literals.
 * In plain tsc, these declarations prevent TS2307 errors for raw text asset imports
 * that come from @firma-ec/tsl-ec's roots.ts / intermediates.ts (pulled in via the
 * signer's bundled-intermediate chain completion).
 */
declare module '*.pem?raw' {
  const content: string;
  export default content;
}

declare module '*.crt?raw' {
  const content: string;
  export default content;
}

declare module '*.cer?raw' {
  const content: string;
  export default content;
}
