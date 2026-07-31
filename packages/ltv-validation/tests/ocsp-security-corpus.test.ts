/**
 * Bidirectional security corpus for the OCSP replay/mismatch closure.
 *
 * LEGITIMATE (must pass, unchanged behavior):
 *   L4 — serial with a DER 0x00 pad, echoed verbatim → accepted.
 *   L5 — responder re-encodes the serial minimally (pad stripped) → accepted.
 *   L6 — multi-entry response, our entry NOT first → selected correctly.
 *   L7 — we send a nonce, the response omits it → accepted (verify-if-present).
 *   (L1-L3 live in the rest of the suite / ocsp-kat-arcotel.test.ts — see
 *   that file's regression comment for L3, the ArgosData signatureValid
 *   false→true flip.)
 *
 * POISONED (must now be rejected — each one PASSED as `good` before this
 * change; run against the pre-fix code to see it fail, see the report):
 *   P1 — CA-signed response, real signature, WRONG certificate (the core
 *        replay attack this whole change closes).
 *   P2 — same serial, different issuerKeyHash.
 *   P3 — multi-entry: target serial under a foreign keyHash, a foreign
 *        serial under the target's keyHash — no entry legitimately matches.
 *   P4 — delegate signed by the CA but missing id-kp-OCSPSigning.
 *   P5 — nonce sent, response echoes a DIFFERENT nonce.
 *   P6 — certs[] empty AND responderID doesn't match the issuer — must
 *        report sig_invalid, never crash (the ArgosData shape done wrong).
 */

import { describe, expect, it } from 'vitest';
import { normalizeSerialHex } from '../src/ocsp/certid';
import { fetchOcsp } from '../src/ocsp/fetch';
import { buildOcspRequest } from '../src/ocsp/request';
import { parseOcspResponse } from '../src/ocsp/response';
import {
  forgeToParsedCert,
  makeDelegateCert,
  makeLeafWithSerial,
  makeMultiSignedOcspResponseDer,
  makeSynthPair,
} from './helpers/synthCerts';

const HOUR_MS = 60 * 60 * 1000;
const OCSP_URL = 'http://ocsp.example.com/';

function freshWindow(now: Date) {
  return { thisUpdate: new Date(now.getTime() - 60_000), nextUpdate: new Date(now.getTime() + HOUR_MS) };
}

describe('OCSP corpus — legitimate (must pass)', () => {
  it('L4: serial with a DER 0x00 pad byte, echoed verbatim, is accepted', async () => {
    const pair = makeSynthPair();
    // First byte's high bit is set ⇒ a real DER encoder pads this with a
    // leading 0x00 to keep the INTEGER non-negative (RFC 5280 §4.1.2.2).
    const leaf = forgeToParsedCert(makeLeafWithSerial(pair, '0080ab', 'TEST-LEAF-PADDED'));
    const ca = forgeToParsedCert(pair.caCert);
    const now = new Date();
    const built = await buildOcspRequest(leaf, ca, { hashAlgo: 'sha1' });
    const responseDer = makeMultiSignedOcspResponseDer({
      entries: [{ requestDer: built.requestDer, ...freshWindow(now), status: 'good' }],
      signerCert: pair.caCert,
      signerKey: pair.caKey,
    });
    const parsed = await parseOcspResponse(responseDer, ca, {
      serialHex: built.serialHex,
      issuerKeyHashHex: built.issuerKeyHashHex,
    });
    expect(parsed.signatureValid).toBe(true);
    expect(parsed.certStatus).toBe('good');
  });

  it('L5: responder re-encodes the serial minimally (pad stripped) — still accepted', async () => {
    const pair = makeSynthPair();
    // Same padded-serial leaf as L4, so there IS a pad to strip.
    const leaf = forgeToParsedCert(makeLeafWithSerial(pair, '0080ab', 'TEST-LEAF-PADDED-2'));
    const ca = forgeToParsedCert(pair.caCert);
    const now = new Date();
    const built = await buildOcspRequest(leaf, ca, { hashAlgo: 'sha1' });
    expect(built.serialHex.toLowerCase()).toBe('0080ab'); // sanity: the pad is really there
    // Simulate a responder that echoes the CertID with the pad stripped
    // instead of verbatim — legal per DER (both denote the same integer).
    const minimalSerialHex = normalizeSerialHex(built.serialHex);
    expect(minimalSerialHex).toBe('80ab');
    const responseDer = makeMultiSignedOcspResponseDer({
      entries: [
        {
          requestDer: built.requestDer,
          ...freshWindow(now),
          status: 'good',
          serialOverrideHex: minimalSerialHex,
        },
      ],
      signerCert: pair.caCert,
      signerKey: pair.caKey,
    });
    const parsed = await parseOcspResponse(responseDer, ca, {
      serialHex: built.serialHex,
      issuerKeyHashHex: built.issuerKeyHashHex,
    });
    expect(parsed.signatureValid).toBe(true);
    expect(parsed.certStatus).toBe('good');
  });

  it('L6: multi-entry response, target entry in position 2, is selected correctly', async () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(pair.leafCert);
    const ca = forgeToParsedCert(pair.caCert);
    // NOTE: makeSynthPair() always mints leafCert with the SAME hardcoded
    // serial ('02ab') — fine for single-pair tests, but useless here where
    // the whole point is a SECOND entry with a genuinely different serial.
    const otherLeaf = forgeToParsedCert(makeLeafWithSerial(pair, '9911cc', 'TEST-LEAF-OTHER-L6'));
    const now = new Date();

    const targetReq = await buildOcspRequest(leaf, ca, { hashAlgo: 'sha1' });
    const otherReq = await buildOcspRequest(otherLeaf, ca, { hashAlgo: 'sha1' });

    const responseDer = makeMultiSignedOcspResponseDer({
      entries: [
        { requestDer: otherReq.requestDer, ...freshWindow(now), status: 'revoked' },
        { requestDer: targetReq.requestDer, ...freshWindow(now), status: 'good' },
      ],
      signerCert: pair.caCert,
      signerKey: pair.caKey,
    });

    const parsed = await parseOcspResponse(responseDer, ca, {
      serialHex: targetReq.serialHex,
      issuerKeyHashHex: targetReq.issuerKeyHashHex,
    });
    expect(parsed.signatureValid).toBe(true);
    // Proves the TARGET entry (position 2) was picked, not the other one.
    expect(parsed.certStatus).toBe('good');
  });

  it('L7: we send a nonce, the response omits it — accepted (verify-if-present)', async () => {
    const pair = makeSynthPair({ withAia: OCSP_URL });
    const leaf = forgeToParsedCert(pair.leafCert);
    const ca = forgeToParsedCert(pair.caCert);
    const now = new Date();
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      const body = new Uint8Array(init?.body as ArrayBuffer);
      // Re-derive serialHex/issuerKeyHashHex isn't needed: echo verbatim.
      const der = makeMultiSignedOcspResponseDer({
        entries: [{ requestDer: body, ...freshWindow(now), status: 'good' }],
        signerCert: pair.caCert,
        signerKey: pair.caKey,
        // No nonceBytes — the responder omits the extension entirely.
      });
      return new Response(der, { status: 200, headers: { 'Content-Type': 'application/ocsp-response' } });
    }) as unknown as typeof globalThis.fetch;

    const r = await fetchOcsp(leaf, ca, { fetchImpl, hashAlgo: 'sha1', nonce: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.status).toBe('good');
  });
});

describe('OCSP corpus — poisoned (must now be rejected)', () => {
  it('P1 (the core attack): CA-signed response, real signature, WRONG certificate → response_mismatch, never good', async () => {
    const pair = makeSynthPair({ withAia: OCSP_URL });
    const targetLeaf = forgeToParsedCert(pair.leafCert);
    // A genuinely different serial (see the L6 note on makeSynthPair()'s
    // hardcoded default serial) issued by the SAME CA — the real-world
    // shape of "another cert from the same issuer".
    const otherLeaf = forgeToParsedCert(makeLeafWithSerial(pair, '9911cc', 'TEST-LEAF-OTHER-P1'));
    const ca = forgeToParsedCert(pair.caCert);
    const now = new Date();

    // The attacker captured a real `good` response for a DIFFERENT cert
    // issued by the same CA and replays it when asked about `targetLeaf`.
    const targetReq = await buildOcspRequest(targetLeaf, ca, { hashAlgo: 'sha1' });
    const otherReq = await buildOcspRequest(otherLeaf, ca, { hashAlgo: 'sha1' });
    const poisoned = makeMultiSignedOcspResponseDer({
      entries: [{ requestDer: otherReq.requestDer, ...freshWindow(now), status: 'good' }],
      signerCert: pair.caCert,
      signerKey: pair.caKey,
    });
    const fetchImpl = (async () =>
      new Response(poisoned, {
        status: 200,
        headers: { 'Content-Type': 'application/ocsp-response' },
      })) as unknown as typeof globalThis.fetch;

    const r = await fetchOcsp(targetLeaf, ca, { fetchImpl, hashAlgo: 'sha1' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('response_mismatch');
      expect(r.detail).toBe('no_matching_single_response');
    }

    // Direct parser-level assertion too: confirms the throw, not just the
    // fetch-level mapping.
    await expect(
      parseOcspResponse(poisoned, ca, {
        serialHex: targetReq.serialHex,
        issuerKeyHashHex: targetReq.issuerKeyHashHex,
      }),
    ).rejects.toMatchObject({ code: 'no_matching_single_response' });
  });

  it('P2: same serial, different issuerKeyHash → rejected', async () => {
    const pair = makeSynthPair();
    const foreignIssuerPair = makeSynthPair(); // different CA key ⇒ different issuerKeyHash
    const leaf = forgeToParsedCert(pair.leafCert);
    const ca = forgeToParsedCert(pair.caCert);
    const foreignCa = forgeToParsedCert(foreignIssuerPair.caCert);
    const now = new Date();

    // Same leaf's serial, but the CertID's issuerKeyHash is computed
    // against a DIFFERENT issuer key — an entry that would only be valid
    // if OUR CA and the foreign CA happened to share a key (they don't).
    const wrongKeyHashReq = await buildOcspRequest(leaf, foreignCa, { hashAlgo: 'sha1' });
    const built = await buildOcspRequest(leaf, ca, { hashAlgo: 'sha1' }); // what we actually asked
    const responseDer = makeMultiSignedOcspResponseDer({
      entries: [{ requestDer: wrongKeyHashReq.requestDer, ...freshWindow(now), status: 'good' }],
      signerCert: pair.caCert, // signed for real by OUR ca (the trust anchor we pass)
      signerKey: pair.caKey,
    });

    await expect(
      parseOcspResponse(responseDer, ca, {
        serialHex: built.serialHex,
        issuerKeyHashHex: built.issuerKeyHashHex,
      }),
    ).rejects.toMatchObject({ code: 'no_matching_single_response' });
  });

  it('P3: multi-entry — target serial under a foreign keyHash, a foreign serial under the target keyHash — neither matches', async () => {
    const pair = makeSynthPair();
    const other = makeSynthPair();
    const leaf = forgeToParsedCert(pair.leafCert);
    // A genuinely different serial (see the L6 note on makeSynthPair()'s
    // hardcoded default serial) — otherwise entryB below would collide
    // with the target's own serial and this test would prove nothing.
    const otherLeaf = forgeToParsedCert(makeLeafWithSerial(pair, '9911cc', 'TEST-LEAF-OTHER-P3'));
    const ca = forgeToParsedCert(pair.caCert);
    const otherCa = forgeToParsedCert(other.caCert);
    const now = new Date();

    const built = await buildOcspRequest(leaf, ca, { hashAlgo: 'sha1' }); // what we ask
    const entryA = await buildOcspRequest(leaf, otherCa, { hashAlgo: 'sha1' }); // target serial, foreign keyHash
    const entryB = await buildOcspRequest(otherLeaf, ca, { hashAlgo: 'sha1' }); // foreign serial, target keyHash

    const responseDer = makeMultiSignedOcspResponseDer({
      entries: [
        { requestDer: entryA.requestDer, ...freshWindow(now), status: 'good' },
        { requestDer: entryB.requestDer, ...freshWindow(now), status: 'good' },
      ],
      signerCert: pair.caCert,
      signerKey: pair.caKey,
    });

    await expect(
      parseOcspResponse(responseDer, ca, {
        serialHex: built.serialHex,
        issuerKeyHashHex: built.issuerKeyHashHex,
      }),
    ).rejects.toMatchObject({ code: 'no_matching_single_response' });
  });

  it('P4: delegate signed by the CA but missing id-kp-OCSPSigning → sig_invalid', async () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(pair.leafCert);
    const ca = forgeToParsedCert(pair.caCert);
    const now = new Date();
    const built = await buildOcspRequest(leaf, ca, { hashAlgo: 'sha1' });

    const delegate = makeDelegateCert(pair, { withOcspEku: false });
    const responseDer = makeMultiSignedOcspResponseDer({
      entries: [{ requestDer: built.requestDer, ...freshWindow(now), status: 'good' }],
      signerCert: delegate.cert,
      signerKey: delegate.key,
      attachCerts: [delegate.cert],
    });

    const parsed = await parseOcspResponse(responseDer, ca, {
      serialHex: built.serialHex,
      issuerKeyHashHex: built.issuerKeyHashHex,
    });
    expect(parsed.signatureValid).toBe(false);
    expect(parsed.signatureDetail).toBe('responder_missing_ocsp_signing_eku');
  });

  it('P4b: sanity — the SAME delegate WITH the EKU is accepted (proves the rejection above is about the EKU, not the delegate shape)', async () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(pair.leafCert);
    const ca = forgeToParsedCert(pair.caCert);
    const now = new Date();
    const built = await buildOcspRequest(leaf, ca, { hashAlgo: 'sha1' });

    const delegate = makeDelegateCert(pair, { withOcspEku: true });
    const responseDer = makeMultiSignedOcspResponseDer({
      entries: [{ requestDer: built.requestDer, ...freshWindow(now), status: 'good' }],
      signerCert: delegate.cert,
      signerKey: delegate.key,
      attachCerts: [delegate.cert],
    });

    const parsed = await parseOcspResponse(responseDer, ca, {
      serialHex: built.serialHex,
      issuerKeyHashHex: built.issuerKeyHashHex,
    });
    expect(parsed.signatureValid).toBe(true);
  });

  it('P5: nonce sent, response echoes a DIFFERENT nonce → response_mismatch', async () => {
    const pair = makeSynthPair({ withAia: OCSP_URL });
    const leaf = forgeToParsedCert(pair.leafCert);
    const ca = forgeToParsedCert(pair.caCert);
    const now = new Date();
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      const body = new Uint8Array(init?.body as ArrayBuffer);
      const wrongNonce = new Uint8Array(16).fill(0x42); // never equals what we sent
      const der = makeMultiSignedOcspResponseDer({
        entries: [{ requestDer: body, ...freshWindow(now), status: 'good' }],
        signerCert: pair.caCert,
        signerKey: pair.caKey,
        nonceBytes: wrongNonce,
      });
      return new Response(der, { status: 200, headers: { 'Content-Type': 'application/ocsp-response' } });
    }) as unknown as typeof globalThis.fetch;

    const r = await fetchOcsp(leaf, ca, { fetchImpl, hashAlgo: 'sha1', nonce: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('response_mismatch');
      expect(r.detail).toBe('nonce_echo_mismatch');
    }
  });

  it('P6: certs[] empty AND responderID does not match the issuer → sig_invalid, no crash', async () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(pair.leafCert);
    const ca = forgeToParsedCert(pair.caCert);
    const now = new Date();
    const built = await buildOcspRequest(leaf, ca, { hashAlgo: 'sha1' });

    const delegate = makeDelegateCert(pair, { withOcspEku: true });
    const responseDer = makeMultiSignedOcspResponseDer({
      entries: [{ requestDer: built.requestDer, ...freshWindow(now), status: 'good' }],
      signerCert: delegate.cert, // signs with the delegate's key...
      signerKey: delegate.key,
      responderIdCert: pair.leafCert, // ...but claims to be a THIRD, unrelated identity
      attachCerts: [], // ...and attaches NO cert to check against (the ArgosData shape).
    });

    const parsed = await parseOcspResponse(responseDer, ca, {
      serialHex: built.serialHex,
      issuerKeyHashHex: built.issuerKeyHashHex,
    });
    expect(parsed.signatureValid).toBe(false);
    expect(parsed.responderCert).toBeNull();
  });

  it('P6b: fetch-level — same shape never surfaces as ok:true', async () => {
    const pair = makeSynthPair({ withAia: OCSP_URL });
    const leaf = forgeToParsedCert(pair.leafCert);
    const ca = forgeToParsedCert(pair.caCert);
    const now = new Date();
    const delegate = makeDelegateCert(pair, { withOcspEku: true });
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      const body = new Uint8Array(init?.body as ArrayBuffer);
      const der = makeMultiSignedOcspResponseDer({
        entries: [{ requestDer: body, ...freshWindow(now), status: 'good' }],
        signerCert: delegate.cert,
        signerKey: delegate.key,
        responderIdCert: pair.leafCert,
        attachCerts: [],
      });
      return new Response(der, { status: 200, headers: { 'Content-Type': 'application/ocsp-response' } });
    }) as unknown as typeof globalThis.fetch;

    const r = await fetchOcsp(leaf, ca, { fetchImpl, hashAlgo: 'sha1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('sig_invalid');
  });
});
