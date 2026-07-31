/**
 * OCSP KAT (Known-Answer Test) against a frozen Let's Encrypt response.
 *
 * The fixture is captured manually (see scripts/capture-le-ocsp.mjs) because
 * the sandbox cannot reach external networks. When the fixture is missing,
 * tests skip with a clear reason.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { describe, expect, it } from 'vitest';
import { parseOcspResponse } from '../src/ocsp/response';
import type { ParsedCert } from '../src/types';

const FX_DIR = resolve(__dirname, '__fixtures__');

function toAB(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function bufToHex(buf: ArrayBuffer | Uint8Array): string {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < u.length; i++) out += (u[i] ?? 0).toString(16).padStart(2, '0');
  return out;
}

/**
 * The KAT is a raw captured response — we don't have the leaf's serial on
 * hand independently, only the response DER itself. Read the CertID's serial
 * straight off the wire (bypassing the module under test) purely so this
 * fixture-driven test can supply the now-mandatory `expected` param; the
 * anti-replay match itself is covered by the synthetic corpus.
 */
function readEchoedSerialHex(der: Uint8Array): string {
  const asn = asn1js.fromBER(toAB(der));
  const ocspResp = new pkijs.OCSPResponse({ schema: asn.result });
  const respBytes = ocspResp.responseBytes;
  if (!respBytes) throw new Error('no responseBytes in KAT fixture');
  const innerHex = (respBytes.response.valueBlock as { valueHex: ArrayBuffer }).valueHex;
  const basicAsn = asn1js.fromBER(innerHex);
  const basic = new pkijs.BasicOCSPResponse({ schema: basicAsn.result });
  const single = basic.tbsResponseData.responses[0];
  if (!single) throw new Error('no SingleResponse in KAT fixture');
  return bufToHex((single.certID.serialNumber.valueBlock as { valueHex: ArrayBuffer }).valueHex);
}

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
    const parsed = await parseOcspResponse(der, issuer, { serialHex: readEchoedSerialHex(der) });
    expect(parsed.certStatus).toBe('good');
    expect(parsed.signatureValid).toBe(true);
  });

  it.runIf(!HAS_KAT)('SKIP rationale: fixture absent, run scripts/capture-le-ocsp.mjs', () => {
    expect(true).toBe(true);
  });
});
