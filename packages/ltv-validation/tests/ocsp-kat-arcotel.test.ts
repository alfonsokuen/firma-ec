/**
 * OCSP KAT against real ARCOTEL-accredited ACE responders.
 *
 * Captured 2026-05-10 from:
 *   - ocspgw.securitydata.net.ec (SECURITY DATA S.A. 2 SubCA-2)
 *   - ocsp.argosdata.com.ec      (ArgosData CA 1 - SHA256)
 *
 * Both responses status=good, captured via `openssl ocsp` against leaf certs
 * extracted from packages/verifier/tests/fixtures/eci-real-*.pdf.
 *
 * If issuer DER is absent, tests SKIP with rationale.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseOcspResponse } from '../src/ocsp/response';
import type { ParsedCert } from '../src/types';

const FX_DIR = resolve(__dirname, '__fixtures__');

function loadDer(name: string): Uint8Array | null {
  const p = resolve(FX_DIR, name);
  if (!existsSync(p)) return null;
  return new Uint8Array(readFileSync(p));
}

const SD_ISSUER = loadDer('securitydata-subca2-issuer.der');
const SD_OCSP = loadDer('securitydata-subca2-ocsp-2026-05-10.der');
const AR_ISSUER = loadDer('argosdata-ca1-issuer.der');
const AR_OCSP = loadDer('argosdata-ace-ocsp-2026-05-10.der');

const HAVE_SD = SD_ISSUER !== null && SD_OCSP !== null;
const HAVE_AR = AR_ISSUER !== null && AR_OCSP !== null;

function fakeIssuer(der: Uint8Array, cn: string): ParsedCert {
  return {
    subjectCN: cn,
    issuerCN: null,
    der,
    notBefore: new Date(0),
    notAfter: new Date(2099, 0, 1),
  };
}

describe('OCSP KAT — ARCOTEL ACEs (real responders)', () => {
  it.skipIf(!HAVE_SD)('SECURITY DATA SubCA-2 OCSP parses and reports good', async () => {
    if (!SD_OCSP || !SD_ISSUER) return;
    const parsed = await parseOcspResponse(SD_OCSP, fakeIssuer(SD_ISSUER, 'SubCA-2 Security Data'));
    expect(parsed.certStatus).toBe('good');
    expect(parsed.serialHex.length).toBeGreaterThan(0);
  });

  it.skipIf(!HAVE_AR)('ArgosData CA 1 OCSP parses and reports good', async () => {
    if (!AR_OCSP || !AR_ISSUER) return;
    const parsed = await parseOcspResponse(
      AR_OCSP,
      fakeIssuer(AR_ISSUER, 'ArgosData CA 1 - SHA256'),
    );
    expect(parsed.certStatus).toBe('good');
    expect(parsed.serialHex.length).toBeGreaterThan(0);
  });

  it.runIf(!HAVE_SD && !HAVE_AR)('SKIP rationale: ARCOTEL ACE fixtures absent', () => {
    expect(true).toBe(true);
  });
});
