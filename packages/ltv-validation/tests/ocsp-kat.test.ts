/**
 * OCSP KAT (Known-Answer Test) against a frozen Let's Encrypt response.
 *
 * The fixture is captured manually (see scripts/capture-le-ocsp.mjs) because
 * the sandbox cannot reach external networks. When the fixture is missing,
 * tests skip with a clear reason.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseOcspResponse } from '../src/ocsp/response';
import type { ParsedCert } from '../src/types';

const FX_DIR = resolve(__dirname, '__fixtures__');

function findKatFile(): string | null {
  if (!existsSync(FX_DIR)) return null;
  const files = readdirSync(FX_DIR).filter((f) => /^le-ocsp-good-\d{4}-\d{2}-\d{2}\.der$/.test(f));
  if (files.length === 0) return null;
  // Newest by name (date suffix)
  files.sort();
  return resolve(FX_DIR, files[files.length - 1]!);
}

const katPath = findKatFile();
const HAS_KAT = katPath !== null && existsSync(`${FX_DIR}/le-issuer.der`);

describe("OCSP KAT (Let's Encrypt good)", () => {
  it.skipIf(!HAS_KAT)('parses fixture and reports status=good', async () => {
    if (!katPath) return; // satisfies type narrowing
    const der = new Uint8Array(readFileSync(katPath));
    const issuerDer = new Uint8Array(readFileSync(`${FX_DIR}/le-issuer.der`));
    const issuer: ParsedCert = {
      subjectCN: 'R3',
      issuerCN: null,
      der: issuerDer,
      notBefore: new Date(0),
      notAfter: new Date(2099, 0, 1),
    };
    const parsed = await parseOcspResponse(der, issuer);
    expect(parsed.certStatus).toBe('good');
    expect(parsed.signatureValid).toBe(true);
  });

  it.runIf(!HAS_KAT)('SKIP rationale: fixture absent, run scripts/capture-le-ocsp.mjs', () => {
    expect(true).toBe(true);
  });
});
