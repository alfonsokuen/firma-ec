import fc from 'fast-check';
import { expect, test } from 'vitest';
import { SBOM_TOOL_VERSION } from './version.js';

test('SBOM_TOOL_VERSION is a non-empty string', () => {
  expect(typeof SBOM_TOOL_VERSION).toBe('string');
  expect(SBOM_TOOL_VERSION.length).toBeGreaterThan(0);
});

test('fast-check property: any string concatenation with version is non-empty', () => {
  fc.assert(
    fc.property(fc.string(), (s) => `${s}${SBOM_TOOL_VERSION}`.length >= SBOM_TOOL_VERSION.length),
  );
});
