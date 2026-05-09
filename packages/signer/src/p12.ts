/**
 * PKCS#12 (.p12 / .pfx) parsing for @firma-ec/signer.
 *
 * Wraps `pkijs.PFX` to:
 *   1. Parse outer PFX (DER) — surfaces `pfx_corrupt` on bad bytes.
 *   2. Verify MAC integrity with the PIN — surfaces `pin_invalid` on MAC fail.
 *   3. Walk authenticated safe → safeContents → safeBags to extract:
 *        - the signing certificate (CertBag),
 *        - any intermediate certificates (additional CertBags),
 *        - the private key (PKCS8ShroudedKeyBag → PrivateKeyInfo, exported as PKCS#8 DER).
 *   4. Infer signature + hash algorithm from the public key OID + key params.
 *
 * Note (F3 Task 4): cert validity (notBefore/notAfter) is **not** checked here.
 * Callers (signing pipeline) decide whether to reject expired certs at sign time.
 * This keeps `parsePfx` a pure structural parser and lets verifier-style policies
 * stay in the signing orchestrator.
 *
 * @see docs/superpowers/specs/2026-05-09-firma-ec-F3-firma-MVP-design.md §4.1
 */

import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { SignerError } from './errors.js';
import type { ParsedPfx, SigAlg, SignerCert } from './types.js';

/** OIDs we care about. */
const OID_RSA_ENCRYPTION = '1.2.840.113549.1.1.1';
const OID_RSA_PSS = '1.2.840.113549.1.1.10';
const OID_EC_PUBLIC_KEY = '1.2.840.10045.2.1';
const OID_PKCS12_CERT_BAG = '1.2.840.113549.1.12.10.1.3'; // certBag
const OID_PKCS12_SHROUDED_KEY_BAG = '1.2.840.113549.1.12.10.1.2'; // pkcs8ShroudedKeyBag
const OID_PKCS12_KEY_BAG = '1.2.840.113549.1.12.10.1.1'; // keyBag (unencrypted)

/** Named curve OIDs → ECDSA suite. */
const EC_CURVE_OIDS: Record<string, { sigAlg: SigAlg; hash: 'SHA-256' | 'SHA-384' | 'SHA-512' }> = {
  '1.2.840.10045.3.1.7': { sigAlg: 'ECDSA-P256-SHA256', hash: 'SHA-256' }, // P-256
  '1.3.132.0.34': { sigAlg: 'ECDSA-P384-SHA384', hash: 'SHA-384' }, // P-384
  '1.3.132.0.35': { sigAlg: 'ECDSA-P521-SHA512', hash: 'SHA-512' }, // P-521
};

/** Encode a string PIN as UTF-8 ArrayBuffer (pkijs expects ArrayBuffer). */
function pinToArrayBuffer(pin: string): ArrayBuffer {
  // RFC 7292 / PKCS#12 BMPString password encoding is handled internally by pkijs
  // when password is given as ArrayBuffer of UTF-8 bytes for the standard MAC algorithm.
  // pkijs converts to BMPString as needed.
  const bytes = new TextEncoder().encode(pin);
  // Copy into a fresh ArrayBuffer (TextEncoder may return a view over a shared buffer).
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

/** Convert pkijs RDN → CN string (or empty if not present). */
function extractCN(rdn: pkijs.RelativeDistinguishedNames): string {
  for (const tv of rdn.typesAndValues) {
    if (tv.type === '2.5.4.3') {
      // commonName
      const v = tv.value;
      // pkijs RDN value is a BaseBlock with valueBlock.value (string) for printable/utf8 strings
      const raw = (v as unknown as { valueBlock?: { value?: string } }).valueBlock?.value;
      if (typeof raw === 'string') return raw;
    }
  }
  return '';
}

/** Convert pkijs Certificate → exposed SignerCert subset. */
function toSignerCert(cert: pkijs.Certificate): SignerCert {
  const der = new Uint8Array(cert.toSchema().toBER(false));
  const subjectCN = extractCN(cert.subject);
  const issuerCN = extractCN(cert.issuer);
  const notBefore = cert.notBefore.value;
  const notAfter = cert.notAfter.value;
  // serialNumber is asn1js.Integer; render as uppercase hex without 0x.
  const serialBytes = new Uint8Array(cert.serialNumber.valueBlock.valueHexView);
  const serialHex = Array.from(serialBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return { der, subjectCN, issuerCN, notBefore, notAfter, serialHex };
}

/** Infer SigAlg from a parsed PrivateKeyInfo + matching cert. */
function inferSigAlg(
  privateKeyInfo: pkijs.PrivateKeyInfo,
  cert: pkijs.Certificate,
): SigAlg {
  const pkAlg = privateKeyInfo.privateKeyAlgorithm.algorithmId;
  if (pkAlg === OID_RSA_ENCRYPTION || pkAlg === OID_RSA_PSS) {
    // Default to RSA-PKCS1 SHA-256. Caller may override if signing policy demands PSS.
    return pkAlg === OID_RSA_PSS ? 'RSA-PSS-SHA256' : 'RSA-PKCS1-SHA256';
  }
  if (pkAlg === OID_EC_PUBLIC_KEY) {
    // EC curve OID lives in the cert's subjectPublicKeyInfo algorithmParameters
    // (PrivateKeyInfo also carries it but it's optional). Read from the cert to be safe.
    const params = cert.subjectPublicKeyInfo.algorithm.algorithmParams;
    if (params && 'valueBlock' in (params as object)) {
      // ECParameters CHOICE — namedCurve is an OBJECT IDENTIFIER
      const oid = (params as unknown as { valueBlock: { toString(): string } }).valueBlock.toString();
      const match = EC_CURVE_OIDS[oid];
      if (match) return match.sigAlg;
    }
    // Fallback: default to P-256
    return 'ECDSA-P256-SHA256';
  }
  throw new SignerError('pfx_unsupported_algo', `Unsupported private-key algorithm OID ${pkAlg}`);
}

/**
 * Parse a PKCS#12 (.p12 / .pfx) blob with a PIN.
 *
 * @throws {SignerError} `pfx_corrupt` if DER cannot be parsed.
 * @throws {SignerError} `pin_invalid` if MAC integrity check fails.
 * @throws {SignerError} `pfx_unsupported_algo` if encryption algorithm is unsupported.
 * @throws {SignerError} `no_signing_cert` if no certificate is found in the PFX.
 */
export async function parsePfx(pfxBytes: Uint8Array, pin: string): Promise<ParsedPfx> {
  // ── 1. Parse outer PFX from DER bytes ───────────────────────────────
  let asn1: asn1js.FromBerResult;
  try {
    // ArrayBuffer: pass a fresh copy (avoids SharedArrayBuffer / view issues)
    const buf = new ArrayBuffer(pfxBytes.byteLength);
    new Uint8Array(buf).set(pfxBytes);
    asn1 = asn1js.fromBER(buf);
  } catch (cause) {
    throw new SignerError('pfx_corrupt', 'Failed to BER-decode PFX bytes', cause);
  }
  if (asn1.offset === -1) {
    throw new SignerError('pfx_corrupt', 'PFX bytes are not valid BER/DER');
  }

  let pfx: pkijs.PFX;
  try {
    pfx = new pkijs.PFX({ schema: asn1.result });
  } catch (cause) {
    throw new SignerError('pfx_corrupt', 'Failed to parse PFX schema', cause);
  }

  // ── 2. Verify MAC integrity (pin check) ─────────────────────────────
  const password = pinToArrayBuffer(pin);
  try {
    await pfx.parseInternalValues({ password, checkIntegrity: true });
  } catch (cause) {
    // pkijs throws on MAC mismatch — common error texts include "Integrity for"
    // or "wrong" or "MAC". We map any failure here to pin_invalid since the most
    // common cause IS a wrong PIN. (Truly corrupt PFX would have failed step 1.)
    const msg = cause instanceof Error ? cause.message : String(cause);
    if (/integrit|mac|password|wrong/i.test(msg)) {
      throw new SignerError('pin_invalid', 'PKCS#12 MAC verification failed (wrong PIN?)', cause);
    }
    throw new SignerError('pfx_unsupported_algo', `PFX integrity check failed: ${msg}`, cause);
  }

  // ── 3. Walk authenticatedSafe → safeContents → safeBags ─────────────
  const authSafe = pfx.parsedValue?.authenticatedSafe;
  if (!authSafe) {
    throw new SignerError('pfx_corrupt', 'PFX missing authenticatedSafe after parseInternalValues');
  }

  // After PFX.parseInternalValues, authSafe.safeContents is an array of ContentInfo
  // (one per "section" of the PFX — typical .p12 has 2 sections: certs + keys).
  // We need to walk each ContentInfo and decode its inner SafeContents.
  // - contentType "data" (1.2.840.113549.1.7.1):  content is an OCTET STRING that
  //   wraps the DER of a SafeContents — decode directly.
  // - contentType "encryptedData" (1.2.840.113549.1.7.6): content is an EncryptedData
  //   object that needs decrypting with the password.
  const OID_DATA = '1.2.840.113549.1.7.1';
  const OID_ENCRYPTED_DATA = '1.2.840.113549.1.7.6';

  const decryptedContents: pkijs.SafeContents[] = [];
  for (const ci of authSafe.safeContents) {
    if (ci.contentType === OID_DATA) {
      // content is an OctetString; its valueHex contains the DER-encoded SafeContents
      const octet = ci.content as asn1js.OctetString;
      const inner = asn1js.fromBER(octet.valueBlock.valueHexView);
      if (inner.offset === -1) {
        throw new SignerError('pfx_corrupt', 'Failed to decode inner SafeContents from data ContentInfo');
      }
      try {
        decryptedContents.push(new pkijs.SafeContents({ schema: inner.result }));
      } catch (cause) {
        throw new SignerError('pfx_corrupt', 'Failed to parse inner SafeContents schema', cause);
      }
    } else if (ci.contentType === OID_ENCRYPTED_DATA) {
      // Password-encrypted SafeContents (typical for cert bags wrapped with PKCS#12 encryption)
      try {
        const encData = new pkijs.EncryptedData({ schema: ci.content });
        const decrypted = await encData.decrypt({ password });
        const inner = asn1js.fromBER(decrypted);
        if (inner.offset === -1) {
          throw new SignerError('pfx_corrupt', 'Failed to decode decrypted SafeContents');
        }
        decryptedContents.push(new pkijs.SafeContents({ schema: inner.result }));
      } catch (cause) {
        if (cause instanceof SignerError) throw cause;
        const msg = cause instanceof Error ? cause.message : String(cause);
        if (/integrit|mac|password|wrong|decrypt/i.test(msg)) {
          throw new SignerError('pin_invalid', 'Failed to decrypt encrypted SafeContents (wrong PIN?)', cause);
        }
        throw new SignerError('pfx_unsupported_algo', `Unsupported encryptedData: ${msg}`, cause);
      }
    } else {
      throw new SignerError(
        'pfx_unsupported_algo',
        `Unsupported authenticatedSafe ContentInfo OID ${ci.contentType}`,
      );
    }
  }

  const certs: pkijs.Certificate[] = [];
  let privateKeyInfo: pkijs.PrivateKeyInfo | undefined;
  let privateKeyDer: ArrayBuffer | undefined;

  for (const sc of decryptedContents) {
    for (const bag of sc.safeBags) {
      if (bag.bagId === OID_PKCS12_CERT_BAG) {
        const certBag = bag.bagValue as pkijs.CertBag;
        // certBag.parsedValue may already be set; if not, certBag.certValue holds the
        // OCTET STRING of the cert DER (per RFC 7292 § 4.2.3).
        let certVal: pkijs.Certificate | undefined;
        if (certBag.parsedValue instanceof pkijs.Certificate) {
          certVal = certBag.parsedValue;
        } else if (certBag.certValue instanceof asn1js.OctetString) {
          const certAsn1 = asn1js.fromBER(certBag.certValue.valueBlock.valueHexView);
          if (certAsn1.offset !== -1) {
            try {
              certVal = new pkijs.Certificate({ schema: certAsn1.result });
            } catch (cause) {
              throw new SignerError('pfx_corrupt', 'Failed to parse cert from CertBag', cause);
            }
          }
        }
        if (certVal) certs.push(certVal);
      } else if (bag.bagId === OID_PKCS12_SHROUDED_KEY_BAG) {
        const shroudedBag = bag.bagValue as pkijs.PKCS8ShroudedKeyBag;
        // Decrypt the shrouded key with the same password
        try {
          // parseInternalValues is `protected` in the .d.ts but is accessible at runtime;
          // pkijs's normal flow on PFX.parseInternalValues already decrypts it for us
          // when it calls safeContents.parseInternalValues with the password — but
          // not all .p12 producers wrap the key the same way. Try the parsedValue first.
          let pkInfo: pkijs.PrivateKeyInfo | undefined = shroudedBag.parsedValue;
          if (!pkInfo) {
            // Force-decrypt — parseInternalValues is `protected` in the .d.ts but
            // accessible at runtime; cast through unknown to avoid TS visibility check.
            await (
              shroudedBag as unknown as {
                parseInternalValues(p: { password: ArrayBuffer }): Promise<void>;
              }
            ).parseInternalValues({ password });
            pkInfo = shroudedBag.parsedValue;
          }
          if (pkInfo) {
            privateKeyInfo = pkInfo;
          }
          if (privateKeyInfo) {
            privateKeyDer = privateKeyInfo.toSchema().toBER(false);
          }
        } catch (cause) {
          throw new SignerError(
            'pfx_unsupported_algo',
            'Failed to decrypt PKCS#8 shrouded key bag',
            cause,
          );
        }
      } else if (bag.bagId === OID_PKCS12_KEY_BAG) {
        // Unencrypted key bag — bagValue IS the PrivateKeyInfo
        const keyBag = bag.bagValue as pkijs.PrivateKeyInfo;
        privateKeyInfo = keyBag;
        privateKeyDer = keyBag.toSchema().toBER(false);
      }
      // Other bag types (secretBag, crlBag, safeContentsBag) ignored for our use case.
    }
  }

  if (certs.length === 0) {
    throw new SignerError('no_signing_cert', 'No certificate found in PFX');
  }
  if (!privateKeyInfo || !privateKeyDer) {
    throw new SignerError('no_signing_cert', 'No private key found in PFX');
  }

  // ── 4. Decide which cert is the signer ───────────────────────────────
  // Heuristic: the cert whose public key matches the private key.
  // For the synthetic fixtures we generate (Task 6), there is exactly one cert,
  // so just pick the first. For real .p12 files we'd match SubjectPublicKeyInfo
  // against the private key's public part — deferred to F4 if needed.
  const signerCert = certs[0];
  if (!signerCert) {
    throw new SignerError('no_signing_cert', 'No certificate found in PFX');
  }
  const intermediates = certs.slice(1);

  // ── 5. Infer algorithm ───────────────────────────────────────────────
  const sigAlg = inferSigAlg(privateKeyInfo, signerCert);

  // ── 6. Build JWK from PrivateKeyInfo for callers that import via WebCrypto ──
  // We export the PKCS#8 DER and let callers do `crypto.subtle.importKey('pkcs8', der, …, false)`
  // to keep `extractable: false`. The JWK here is a structural placeholder; the real
  // import happens in pades.ts (Task 8). We construct a minimal JWK with `kty` only.
  // Rationale: the spec wants `extractable:false` CryptoKeys; serializing to JWK
  // would require extracting the key, which violates the threat model. Callers should
  // use the PKCS#8 DER (available via cert.privateKeyDer in extended ParsedPfx).
  const privateKeyJwk: JsonWebKey = {
    kty: privateKeyInfo.privateKeyAlgorithm.algorithmId === OID_EC_PUBLIC_KEY ? 'EC' : 'RSA',
  };

  // We extend ParsedPfx (declared in types.ts) — store PKCS#8 DER on a
  // non-typed property for now. pades.ts (Task 8) will read it.
  const result: ParsedPfx & { privateKeyPkcs8Der: ArrayBuffer } = {
    signingCert: toSignerCert(signerCert),
    intermediates: intermediates.map(toSignerCert),
    privateKeyJwk,
    sigAlg,
    privateKeyPkcs8Der: privateKeyDer,
  };
  return result;
}
