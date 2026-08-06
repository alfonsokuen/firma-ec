import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { resolveSigningIntermediates } from '../src/chainIntermediates.js';

const FIXTURES = join(import.meta.dirname, '..', '..', 'verifier', 'tests', 'fixtures');

/**
 * 2026-08-05 P0 fix, found by an independent silent-failure-hunter pass on
 * F1: `resolveSigningIntermediates` marked a chain `complete` ONLY if the
 * walk embedded a self-signed cert — but `getIntermediates()` (the bundle it
 * walks) never contains a root; roots live in a separate bundle this
 * function used to never consult. Result: EVERY real Ecuadorian signature —
 * not just broken ones — came back `complete: false`, so the "chain
 * incomplete" warning fired on 100% of healthy signatures.
 *
 * These tests use REAL leaf fixtures (not synthetic PKI) against the REAL
 * production bundle (`getIntermediates()` / `getTrustRoots()`, no overrides)
 * — the same fixtures an independent code-reviewer already used to prove the
 * BCE selector fix (see certcheck-bce-real.test.ts in the verifier package).
 * A synthetic-only test shares the same assumption the code does and can't
 * refute it.
 */
describe('resolveSigningIntermediates — real ACE leaves resolve complete:true against the production bundle', () => {
  test('UANATACA leaf-only (subCA in bundle, root known) → complete, only the subCA embedded', async () => {
    const leafDer = new Uint8Array(readFileSync(join(FIXTURES, 'leaf-uanataca.der')));

    const resolved = await resolveSigningIntermediates(leafDer, [], undefined, null);

    expect(resolved.complete, 'root is a known trust anchor — nothing left to bridge').toBe(true);
    expect(resolved.missingIssuerDn).toBeUndefined();
    expect(resolved.ders.length, 'only the subCA is embedded, never the root').toBe(1);
  });

  test('BCE leaf-only (subCA in bundle, root known) → complete, only the live subCA embedded', async () => {
    const leafDer = new Uint8Array(readFileSync(join(FIXTURES, 'leaf-bce.der')));

    const resolved = await resolveSigningIntermediates(leafDer, [], undefined, null);

    expect(resolved.complete, 'root is a known trust anchor — nothing left to bridge').toBe(true);
    expect(resolved.missingIssuerDn).toBeUndefined();
    expect(resolved.ders.length).toBe(1);
  });
});
