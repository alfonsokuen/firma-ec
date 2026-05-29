import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pkijs from 'pkijs';
import { beforeAll, describe, expect, test } from 'vitest';
import { parseCms } from '../src/cms';
import { checkCertificate } from '../src/index';
import { findSignature } from '../src/pdf';

/**
 * Regression: "Validar certificado" crashed with `Cannot read properties of
 * undefined (reading 'buffer')` for a leaf-only .p12 (e.g. UANATACA, Security
 * Data) when `checkRevocation` is on.
 *
 * Root cause: checkCertificate appends a BUNDLED subordinate CA to bridge the
 * leaf to its root, but indexed the ORIGINAL `intermediatesDer` array to build
 * the issuer's OCSP CertID. For a leaf-only cert that array is empty, so the
 * bundled intermediate's DER read as `undefined` and the OCSP request builder
 * dereferenced `undefined.buffer`. Fix: track DERs aligned 1:1 as bundled CAs
 * are appended.
 *
 * This drives the exact path with a committed Security Data fixture (its leaf
 * is issued by the bundled "SUBCA-2 SECURITY DATA") and NO supplied
 * intermediates, with an offline fetch impl so OCSP/CRL degrade to 'unknown'.
 */

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

beforeAll(() => {
  pkijs.setEngine(
    'node-webcrypto',
    new pkijs.CryptoEngine({ name: 'node-webcrypto', crypto: webcrypto as unknown as Crypto }),
  );
  if (!(globalThis as { crypto?: Crypto }).crypto) {
    (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;
  }
});

describe('checkCertificate revocation with bundled intermediate (leaf-only)', () => {
  test('builds OCSP without crashing when a bundled CA bridges the chain', async () => {
    const bytes = new Uint8Array(await readFile(resolve(FIX, 'eci-real-contrato2026.pdf')));
    const sig = await findSignature(bytes);
    expect(sig).not.toBeNull();
    const cms = await parseCms(sig!.contents);
    const leafDer = new Uint8Array(cms.signerCert.toSchema().toBER(false));

    let fetchCalls = 0;
    const fetchImpl = (() => {
      fetchCalls++;
      return Promise.reject(new Error('offline-test'));
    }) as unknown as typeof fetch;

    // Pass NO intermediates → the bundled Security Data SUBCA-2 must bridge the
    // chain, exercising the previously-crashing OCSP issuer path.
    const res = await checkCertificate(leafDer, [], {
      checkRevocation: true,
      fetchImpl,
      revocationTimeoutMs: 2000,
    });

    // The bundled SUBCA-2 bridged leaf → Security Data root (proves the append
    // happened — i.e. the regression path ran).
    expect(res.matchedAceSlug).toBe('securitydata');
    // OCSP request built (offline transport → unknown). Crucially: no throw.
    expect(res.revocationStatus).toBe('unknown');
    // The offline fetch was actually reached → buildOcspRequest succeeded.
    expect(fetchCalls).toBeGreaterThan(0);
  }, 30000);
});
