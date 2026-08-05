import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getIntermediates, getTrustRoots } from '@firma-ec/tsl-ec';
import { describe, expect, test } from 'vitest';
import { checkCertificate } from '../src/certCheck';

const FIXTURES = join(import.meta.dirname, 'fixtures');

/**
 * 2026-08-05 HIGH fix, third selector (certCheck.ts:241) found by an
 * independent code-reviewer AFTER the first fix round (index.ts + signer's
 * chainIntermediates.ts) had already landed. Same root cause: `bce-subca-2011`
 * (expired) and `bce-subca-2019` (live) share one subject DN, and this
 * selector alone still picked whichever is declared first via `Array.find()`.
 *
 * Exercised against the REAL bundled trust store (`getTrustRoots()` /
 * `getIntermediates()`, no synthetic stand-ins) and a real BCE leaf fixture,
 * because a synthetic-only test shares the same assumption the code does and
 * can't refute it — see resolve-issuer-cert.test.ts's own doc for why a
 * second, real-data test was added here instead of extending that file.
 */
describe('checkCertificate — real BCE leaf resolves to the live subCA (not the expired one)', () => {
  test('leaf-only .p12 (no intermediate embedded) still chains to the live 2019 subCA', async () => {
    const certDer = new Uint8Array(readFileSync(join(FIXTURES, 'leaf-bce.der')));
    const roots = await getTrustRoots();
    const intermediates = await getIntermediates();

    // Fixed inside the leaf's real validity window (2024-05-23 .. 2026-05-23) —
    // the fixture itself expires before "now" in later runs, and this test is
    // about issuer resolution, not the wall clock.
    const result = await checkCertificate(certDer, [], {
      trustRoots: roots,
      trustIntermediates: intermediates,
      atTime: new Date('2026-01-01T00:00:00Z'),
    });

    expect(result.trusted, 'must chain to the trusted BCE root via the live subCA').toBe(true);
    expect(result.matchedAceSlug).toBe('bce');
  });
});
