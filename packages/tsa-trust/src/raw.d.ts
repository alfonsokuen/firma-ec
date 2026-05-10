/**
 * Type declarations for Vite's `?raw` import suffix (mirrors tsl-ec).
 * In plain tsc these declarations prevent TS2307 errors for raw text PEM imports.
 */
declare module '*.pem?raw' {
  const content: string;
  export default content;
}
