/**
 * L8 / P7 — `ocspMatchesCert` (packages/verifier/src/ltv.ts), exercised via
 * the real `verifyLtv` entry point against a synthetic DSS.
 *
 * Prior bug: `ocspMatchesCert` stripped the leading zero-pad byte from the
 * SUBJECT's DER serial but compared it against the OCSP response's
 * `serialHex` UNNORMALIZED. Any leaf whose serial happens to DER-encode with
 * the 0x00 high-bit pad (routine — any serial whose first byte's high bit is
 * set gets one) could never match its own embedded OCSP evidence, silently
 * discarding it (L8). Independently, nothing stopped a `good` response for a
 * DIFFERENT cert issued by the same CA from being read as if it applied to
 * the cert under verification (P7) — the fix passes `expected.serialHex`
 * into `parseOcspResponse` at the call site, which now enforces the match
 * itself (see `ocsp-security-corpus.test.ts` in ltv-validation for the
 * fetch-path equivalent, P1-P6).
 *
 * @see packages/ltv-validation/tests/ocsp-security-corpus.test.ts
 */

import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { describe, expect, it } from 'vitest';
import { buildOcspRequest } from '@firma-ec/ltv-validation';
import type { DssData } from '../src/dss';
import { verifyLtv } from '../src/ltv';
// Cross-package test helper — same pattern already used by
// packages/signer/tests/{ltv-deadline,pades-ltv-cache}.test.ts.
import {
  forgeToParsedCert,
  makeLeafWithSerial,
  makeSignedOcspResponseDer,
  makeSynthPair,
} from '../../ltv-validation/tests/helpers/synthCerts.js';

function toAB(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function pkijsCertFromDer(der: Uint8Array): pkijs.Certificate {
  const asn = asn1js.fromBER(toAB(der));
  if (asn.offset === -1) throw new Error('cert decode failed');
  return new pkijs.Certificate({ schema: asn.result });
}

async function vriKeyFor(signatureContents: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', toAB(signatureContents)));
  let out = '';
  for (const b of h) out += b.toString(16).padStart(2, '0');
  return out.toUpperCase();
}

const PDF_STUB = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7

describe('verifyLtv — OCSP-to-cert matching (L8 / P7)', () => {
  it('L8: a leaf whose DER serial carries the 0x00 pad byte still matches its OWN good OCSP evidence', async () => {
    const pair = makeSynthPair();
    // High bit of the first byte set ⇒ a real DER encoder MUST prepend 0x00
    // to keep the value non-negative (RFC 5280 §4.1.2.2 / ITU-T X.690
    // §8.3.2) — this is the routine case the old code broke on, not a
    // contrived one; any CA issuing serials that happen to start ≥0x80 hits
    // it on every such certificate.
    const leaf = makeLeafWithSerial(pair, '0080ab', 'TEST-LEAF-PADDED-SERIAL');
    const leafParsed = forgeToParsedCert(leaf);
    const caParsed = forgeToParsedCert(pair.caCert);

    const now = new Date();
    const built = await buildOcspRequest(leafParsed, caParsed, { hashAlgo: 'sha1' });
    const responseDer = makeSignedOcspResponseDer({
      requestDer: built.requestDer,
      caCert: pair.caCert,
      caKey: pair.caKey,
      thisUpdate: new Date(now.getTime() - 60_000),
      nextUpdate: new Date(now.getTime() + 3_600_000),
      status: 'good',
    });

    const chain = [pkijsCertFromDer(leafParsed.der), pkijsCertFromDer(caParsed.der)];
    const signatureContents = new TextEncoder().encode('l8-signature-contents');
    const vriKey = await vriKeyFor(signatureContents);
    const dss: DssData = {
      certs: [],
      ocsps: [responseDer],
      crls: [],
      vri: { [vriKey]: { certIndices: [], ocspIndices: [0], crlIndices: [] } },
    };

    const r = await verifyLtv(chain, dss, signatureContents, PDF_STUB);
    expect(r.retrospectiveValid).toBe(true);
    expect(r.errors.some((e) => e.startsWith('cert_revoked'))).toBe(false);
  });

  it('P7: a good OCSP response for a DIFFERENT cert issued by the same CA never counts as evidence for the cert under verification', async () => {
    const pair = makeSynthPair();
    const subjectLeaf = makeLeafWithSerial(pair, '11aa', 'TEST-LEAF-SUBJECT');
    const otherLeaf = makeLeafWithSerial(pair, '22bb', 'TEST-LEAF-OTHER');
    const subjectParsed = forgeToParsedCert(subjectLeaf);
    const otherParsed = forgeToParsedCert(otherLeaf);
    const caParsed = forgeToParsedCert(pair.caCert);

    // A perfectly legitimate response — CA-signed, status good — but it
    // answers `otherLeaf`, never `subjectLeaf`. This is the DSS-embedded
    // shape of the P1 replay attack: real signature, wrong certificate.
    const now = new Date();
    const built = await buildOcspRequest(otherParsed, caParsed, { hashAlgo: 'sha1' });
    const responseDer = makeSignedOcspResponseDer({
      requestDer: built.requestDer,
      caCert: pair.caCert,
      caKey: pair.caKey,
      thisUpdate: new Date(now.getTime() - 60_000),
      nextUpdate: new Date(now.getTime() + 3_600_000),
      status: 'good',
    });

    const chain = [pkijsCertFromDer(subjectParsed.der), pkijsCertFromDer(caParsed.der)];
    const signatureContents = new TextEncoder().encode('p7-signature-contents');
    const vriKey = await vriKeyFor(signatureContents);
    const dss: DssData = {
      certs: [],
      ocsps: [responseDer],
      crls: [],
      vri: { [vriKey]: { certIndices: [], ocspIndices: [0], crlIndices: [] } },
    };

    const r = await verifyLtv(chain, dss, signatureContents, PDF_STUB);
    // The mismatched response must never be read as evidence for the
    // subject — neither cleared nor (if it had been `revoked`) flagged.
    expect(r.retrospectiveValid).toBe(false);
    expect(r.errors.some((e) => e.startsWith('cert_revoked'))).toBe(false);
  });
});
