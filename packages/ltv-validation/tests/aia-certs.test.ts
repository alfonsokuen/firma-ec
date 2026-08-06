/**
 * F1 — AIA caIssuers fallback (fetchIssuerCertViaAia).
 *
 * Covers: success (mocked fetch returns a real, verifying DER), timeout,
 * no AIA on the cert, a response that does NOT cryptographically verify
 * (must be rejected, never embedded), and a response that is too large.
 */
import * as asn1js from 'asn1js';
import forge from 'node-forge';
import * as pkijs from 'pkijs';
import { describe, expect, it } from 'vitest';
import { fetchIssuerCertViaAia } from '../src/aia-certs';
import { aiaCertCacheKey, createAiaCertCache } from '../src/cache';
import { forgeToParsedCert, makeSynthPair } from './helpers/synthCerts';
import type { SynthPair } from './helpers/synthCerts';

const OID_AIA = '1.3.6.1.5.5.7.1.1';
const OID_AD_CA_ISSUERS = '1.3.6.1.5.5.7.48.2';

function uint8ToBin(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i] ?? 0);
  return s;
}

function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

/** Build the extnValue OCTET STRING contents for an AIA extension with a
 *  single caIssuers AccessDescription (RFC 5280 §4.2.2.1). */
function buildCaIssuersAiaExtnValueDer(url: string): string {
  const uriBytes = new Uint8Array(url.length);
  for (let i = 0; i < url.length; i++) uriBytes[i] = url.charCodeAt(i) & 0xff;
  const accessLocation = new asn1js.Primitive({
    idBlock: { tagClass: 3, tagNumber: 6 } as never, // [6] context-specific, IA5String IMPLICIT
    valueHex: toArrayBuffer(uriBytes),
  });
  const accessDescription = new asn1js.Sequence({
    value: [new asn1js.ObjectIdentifier({ value: OID_AD_CA_ISSUERS }), accessLocation],
  });
  const aia = new asn1js.Sequence({ value: [accessDescription] });
  return uint8ToBin(new Uint8Array(aia.toBER(false)));
}

/** Build a fresh leaf, signed by `pair`'s CA, carrying a caIssuers AIA URL
 *  pointing at the CA cert itself (the shape a real ACE publishes). */
function leafWithCaIssuersAia(pair: SynthPair, url: string): forge.pki.Certificate {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const now = new Date();
  const leaf = forge.pki.createCertificate();
  leaf.publicKey = keys.publicKey;
  leaf.serialNumber = '05ab';
  leaf.validity.notBefore = new Date(now.getTime() - 86400000);
  leaf.validity.notAfter = new Date(now.getTime() + 180 * 86400000);
  leaf.setSubject([{ name: 'commonName', value: 'AIA-TEST-LEAF' }]);
  leaf.setIssuer(pair.caCert.subject.attributes);
  leaf.setExtensions([
    { name: 'basicConstraints', cA: false } as forge.pki.CertificateExtension,
    {
      id: OID_AIA,
      critical: false,
      value: buildCaIssuersAiaExtnValueDer(url),
    } as unknown as forge.pki.CertificateExtension,
  ]);
  leaf.sign(pair.caKey, forge.md.sha256.create());
  return leaf;
}

function forgeCertToDer(cert: forge.pki.Certificate): Uint8Array {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const u = new Uint8Array(der.length);
  for (let i = 0; i < der.length; i++) u[i] = der.charCodeAt(i) & 0xff;
  return u;
}

/** Wrap a single forge cert into a PKCS#7 "certs-only" degenerate SignedData DER. */
function forgeCertToPkcs7CertsOnly(cert: forge.pki.Certificate): Uint8Array {
  const der = forgeCertToDer(cert);
  const asn = asn1js.fromBER(toArrayBuffer(der));
  if (asn.offset === -1) throw new Error('cert decode failed');
  const pkiCert = new pkijs.Certificate({ schema: asn.result });

  const signedData = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: pkijs.ContentInfo.DATA,
    }),
    certificates: [pkiCert],
    signerInfos: [],
  });
  const contentInfo = new pkijs.ContentInfo({
    contentType: pkijs.ContentInfo.SIGNED_DATA,
    content: signedData.toSchema(true),
  });
  return new Uint8Array(contentInfo.toSchema().toBER(false));
}

const AIA_URL = 'http://aia.example.com/subordinate1.crt';

describe('fetchIssuerCertViaAia', () => {
  it('returns no_aia when the cert has no caIssuers AIA URL', async () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(pair.leafCert);
    const r = await fetchIssuerCertViaAia(leaf, {
      fetchImpl: (() => {
        throw new Error('must not fetch');
      }) as unknown as typeof globalThis.fetch,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_aia');
  });

  it('success: DER response for a cert that actually issued the leaf is verified and returned', async () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(leafWithCaIssuersAia(pair, AIA_URL));
    const caDer = forgeCertToDer(pair.caCert);

    let calledUrl = '';
    const mockFetch = (async (u: string) => {
      calledUrl = u;
      return new Response(toArrayBuffer(caDer), {
        status: 200,
        headers: { 'content-length': String(caDer.byteLength) },
      });
    }) as unknown as typeof globalThis.fetch;

    const r = await fetchIssuerCertViaAia(leaf, { fetchImpl: mockFetch });
    expect(calledUrl).toBe(AIA_URL);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.certDer).toEqual(caDer);
    }
  });

  it('success: PKCS#7 certs-only bundle response is parsed and the matching cert verified', async () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(leafWithCaIssuersAia(pair, AIA_URL));
    const caDer = forgeCertToDer(pair.caCert);
    const p7c = forgeCertToPkcs7CertsOnly(pair.caCert);

    const mockFetch = (async () =>
      new Response(toArrayBuffer(p7c), {
        status: 200,
        headers: { 'content-length': String(p7c.byteLength) },
      })) as unknown as typeof globalThis.fetch;

    const r = await fetchIssuerCertViaAia(leaf, { fetchImpl: mockFetch });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.certDer).toEqual(caDer);
    }
  });

  it('returns timeout on AbortError', async () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(leafWithCaIssuersAia(pair, AIA_URL));
    const mockFetch = (async () => {
      const e = new Error('aborted') as Error & { name: string };
      e.name = 'AbortError';
      throw e;
    }) as unknown as typeof globalThis.fetch;

    const r = await fetchIssuerCertViaAia(leaf, { fetchImpl: mockFetch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('timeout');
  });

  it('rejects (signature_invalid) a response cert that does NOT cryptographically verify — never embedded', async () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(leafWithCaIssuersAia(pair, AIA_URL));

    // A DIFFERENT CA (rogue key), but with the SAME subject DN as the real
    // issuer — an attacker-controlled responder trying to pass off a rogue
    // cert as the real one. Same-subject-different-key must still fail the
    // cryptographic verify() step.
    const rogueKeys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const rogueCa = forge.pki.createCertificate();
    rogueCa.publicKey = rogueKeys.publicKey;
    rogueCa.serialNumber = '09';
    rogueCa.validity.notBefore = pair.caCert.validity.notBefore;
    rogueCa.validity.notAfter = pair.caCert.validity.notAfter;
    rogueCa.setSubject(pair.caCert.subject.attributes);
    rogueCa.setIssuer(pair.caCert.subject.attributes);
    rogueCa.setExtensions([
      { name: 'basicConstraints', cA: true } as forge.pki.CertificateExtension,
    ]);
    rogueCa.sign(rogueKeys.privateKey, forge.md.sha256.create()); // self-signed with the rogue key

    const rogueDer = forgeCertToDer(rogueCa);
    const mockFetch = (async () =>
      new Response(toArrayBuffer(rogueDer), {
        status: 200,
        headers: { 'content-length': String(rogueDer.byteLength) },
      })) as unknown as typeof globalThis.fetch;

    const r = await fetchIssuerCertViaAia(leaf, { fetchImpl: mockFetch });
    expect(r.ok, 'a non-verifying cert must never be accepted').toBe(false);
    if (!r.ok) expect(r.reason).toBe('signature_invalid');
  });

  it('returns malformed when the response is too large (content-length)', async () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(leafWithCaIssuersAia(pair, AIA_URL));
    const mockFetch = (async () =>
      new Response(new Uint8Array(10), {
        status: 200,
        headers: { 'content-length': String(300 * 1024) },
      })) as unknown as typeof globalThis.fetch;

    const r = await fetchIssuerCertViaAia(leaf, { fetchImpl: mockFetch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('malformed');
  });

  it('caches a successful resolution and does not re-fetch on the second call', async () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(leafWithCaIssuersAia(pair, AIA_URL));
    const caDer = forgeCertToDer(pair.caCert);
    const cache = createAiaCertCache();

    let fetchCount = 0;
    const mockFetch = (async () => {
      fetchCount++;
      return new Response(toArrayBuffer(caDer), {
        status: 200,
        headers: { 'content-length': String(caDer.byteLength) },
      });
    }) as unknown as typeof globalThis.fetch;

    const r1 = await fetchIssuerCertViaAia(leaf, { fetchImpl: mockFetch, cache });
    const r2 = await fetchIssuerCertViaAia(leaf, { fetchImpl: mockFetch, cache });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(fetchCount).toBe(1);
  });

  // 2026-08-05 HIGH-1a — real ACE responders (UANATACA confirmed) serve PEM,
  // not DER/PKCS#7. Regression for the fix in parsePemCerts().
  it('success: PEM response (BEGIN/END CERTIFICATE armor) is parsed and the matching cert verified', async () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(leafWithCaIssuersAia(pair, AIA_URL));
    const caDer = forgeCertToDer(pair.caCert);
    const pem = forge.pki.certificateToPem(pair.caCert);
    const pemBytes = new TextEncoder().encode(pem);

    const r = await fetchIssuerCertViaAia(leaf, {
      fetchImpl: (async () =>
        new Response(toArrayBuffer(pemBytes), {
          status: 200,
          headers: { 'content-length': String(pemBytes.byteLength) },
        })) as unknown as typeof globalThis.fetch,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.certDer).toEqual(caDer);
  });

  it('returns malformed for plain text that is neither DER, PKCS#7, nor PEM', async () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(leafWithCaIssuersAia(pair, AIA_URL));
    const body = new TextEncoder().encode('<html><body>404 not found</body></html>');

    const r = await fetchIssuerCertViaAia(leaf, {
      fetchImpl: (async () =>
        new Response(toArrayBuffer(body), {
          status: 200,
          headers: { 'content-length': String(body.byteLength) },
        })) as unknown as typeof globalThis.fetch,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('malformed');
  });

  // 2026-08-05 HIGH-2 — a cache hit used to be trusted unconditionally. A
  // single caIssuers URL can legitimately serve a DIFFERENT cert to a
  // different child (subCA rotation); trusting a stale/mismatched cache
  // entry would violate the module's own unconditional guarantee ("the
  // returned cert MUST have cryptographically signed the child"). This
  // proves a cache hit that does NOT verify the current child is treated
  // as a miss — falls through to a live fetch instead of returning garbage.
  it('a cache hit that does not verify the current child falls through to a live fetch, never returns the stale cert', async () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(leafWithCaIssuersAia(pair, AIA_URL));
    const realCaDer = forgeCertToDer(pair.caCert);
    const cache = createAiaCertCache();

    // Pre-poison the cache with an unrelated (but valid CA:TRUE) cert that did
    // NOT sign this particular leaf — simulates a stale/mismatched entry.
    const rogueKeys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const rogueCa = forge.pki.createCertificate();
    rogueCa.publicKey = rogueKeys.publicKey;
    rogueCa.serialNumber = '11';
    rogueCa.validity.notBefore = pair.caCert.validity.notBefore;
    rogueCa.validity.notAfter = pair.caCert.validity.notAfter;
    rogueCa.setSubject([{ name: 'commonName', value: 'UNRELATED-CA' }]);
    rogueCa.setIssuer([{ name: 'commonName', value: 'UNRELATED-CA' }]);
    rogueCa.setExtensions([
      { name: 'basicConstraints', cA: true } as forge.pki.CertificateExtension,
    ]);
    rogueCa.sign(rogueKeys.privateKey, forge.md.sha256.create());
    const rogueDer = forgeCertToDer(rogueCa);

    const cacheKey = await aiaCertCacheKey(AIA_URL);
    cache.set(cacheKey, { certDer: rogueDer });

    let fetchCount = 0;
    const mockFetch = (async () => {
      fetchCount++;
      return new Response(toArrayBuffer(realCaDer), {
        status: 200,
        headers: { 'content-length': String(realCaDer.byteLength) },
      });
    }) as unknown as typeof globalThis.fetch;

    const r = await fetchIssuerCertViaAia(leaf, { fetchImpl: mockFetch, cache });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.certDer).toEqual(realCaDer);
    expect(fetchCount, 'a non-verifying cache hit must fall through to a live fetch').toBe(1);
  });
});
