/**
 * Vite's `?raw` import suffix, as consumed transitively from @firma-ec/tsl-ec
 * and @firma-ec/tsa-trust (their PEM trust anchors). Mirrors
 * packages/signer/src/raw.d.ts; the runtime counterpart is the raw-asset
 * plugin in build.mjs.
 */
declare module '*?raw' {
  const content: string;
  export default content;
}
