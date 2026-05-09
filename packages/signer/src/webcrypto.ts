/**
 * WebCrypto bridge for @firma-ec/signer.
 *
 * Imports a PKCS#8 private key as a non-extractable `CryptoKey` (threat-model
 * critical: the key MUST never be exportable, so callers cannot accidentally
 * leak it). Signs arbitrary bytes with the appropriate AlgorithmIdentifier
 * for the SigAlg suite.
 *
 * For ECDSA the WebCrypto output is the raw `r||s` concatenation — CMS expects
 * an ASN.1 `SEQUENCE { r INTEGER, s INTEGER }`, so we DER-encode it here. This
 * is the inverse of the conversion the verifier package does in
 * `integrity.ts::asn1ToRawEcdsa` (kept symmetric on purpose).
 *
 * @see docs/superpowers/specs/2026-05-09-firma-ec-F3-firma-MVP-design.md §4.2
 */

import { SignerError } from './errors.js';
import type { SigAlg } from './types.js';

/** Hash for a SigAlg suite. */
export type HashAlg = 'SHA-256' | 'SHA-384' | 'SHA-512';

/** Map SigAlg → hash. */
export function hashOf(sigAlg: SigAlg): HashAlg {
  if (sigAlg.endsWith('-SHA256')) return 'SHA-256';
  if (sigAlg.endsWith('-SHA384')) return 'SHA-384';
  if (sigAlg.endsWith('-SHA512')) return 'SHA-512';
  throw new SignerError('webcrypto_unsupported_alg', `Cannot infer hash for ${sigAlg}`);
}

/** Map SigAlg → WebCrypto AlgorithmIdentifier for `importKey`. */
function importAlg(sigAlg: SigAlg, hash: HashAlg): RsaHashedImportParams | EcKeyImportParams {
  if (sigAlg.startsWith('RSA-PKCS1')) return { name: 'RSASSA-PKCS1-v1_5', hash };
  if (sigAlg.startsWith('RSA-PSS')) return { name: 'RSA-PSS', hash };
  if (sigAlg.startsWith('ECDSA')) {
    const namedCurve =
      sigAlg === 'ECDSA-P256-SHA256'
        ? 'P-256'
        : sigAlg === 'ECDSA-P384-SHA384'
          ? 'P-384'
          : 'P-521';
    return { name: 'ECDSA', namedCurve };
  }
  throw new SignerError('webcrypto_unsupported_alg', `Unknown SigAlg ${sigAlg}`);
}

/** Map SigAlg + hash → WebCrypto AlgorithmIdentifier for `sign`. */
function signAlg(
  sigAlg: SigAlg,
  hash: HashAlg,
): AlgorithmIdentifier | RsaPssParams | EcdsaParams {
  if (sigAlg.startsWith('RSA-PKCS1')) return 'RSASSA-PKCS1-v1_5';
  if (sigAlg.startsWith('RSA-PSS')) {
    const saltLength = hash === 'SHA-256' ? 32 : hash === 'SHA-384' ? 48 : 64;
    return { name: 'RSA-PSS', saltLength };
  }
  if (sigAlg.startsWith('ECDSA')) return { name: 'ECDSA', hash };
  throw new SignerError('webcrypto_unsupported_alg', `Unknown SigAlg ${sigAlg}`);
}

/**
 * Import a PKCS#8 DER-encoded private key as a non-extractable CryptoKey.
 *
 * `extractable: false` is the security invariant: once imported, the key
 * cannot be re-serialized to JWK/raw, so a downstream bug or attacker that
 * somehow gains the CryptoKey still can't pull bytes out.
 */
export async function importPrivateKey(
  pkcs8Der: ArrayBuffer,
  sigAlg: SigAlg,
): Promise<CryptoKey> {
  const hash = hashOf(sigAlg);
  const algo = importAlg(sigAlg, hash);
  try {
    return await crypto.subtle.importKey('pkcs8', pkcs8Der, algo, false, ['sign']);
  } catch (cause) {
    throw new SignerError(
      'webcrypto_unsupported_alg',
      `WebCrypto importKey failed for ${sigAlg}: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    );
  }
}

/**
 * Sign `data` with the provided non-extractable CryptoKey.
 *
 * For ECDSA the WebCrypto output (raw `r||s`) is converted to ASN.1
 * `SEQUENCE { r, s }` so the byte stream matches what CMS / X.509 expect.
 * RSA outputs (PKCS#1 v1.5 or PSS) need no conversion.
 */
export async function signWithKey(
  key: CryptoKey,
  data: Uint8Array,
  sigAlg: SigAlg,
): Promise<ArrayBuffer> {
  const hash = hashOf(sigAlg);
  const algo = signAlg(sigAlg, hash);
  let raw: ArrayBuffer;
  try {
    raw = await crypto.subtle.sign(
      algo as AlgorithmIdentifier,
      key,
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    );
  } catch (cause) {
    throw new SignerError(
      'sign_failed',
      `WebCrypto sign failed for ${sigAlg}: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    );
  }
  if (sigAlg.startsWith('ECDSA')) {
    return rawEcdsaToAsn1(new Uint8Array(raw));
  }
  return raw;
}

/**
 * Convert WebCrypto ECDSA output (raw `r||s`, fixed-width per curve) into
 * the DER `SEQUENCE { r INTEGER, s INTEGER }` form CMS expects.
 *
 * Uses asn1js dynamically to avoid a top-level dep on it for non-ECDSA paths.
 */
async function rawEcdsaToAsn1(rs: Uint8Array): Promise<ArrayBuffer> {
  const fieldBytes = rs.length / 2;
  const r = rs.subarray(0, fieldBytes);
  const s = rs.subarray(fieldBytes);
  const asn1js = await import('asn1js');
  const seq = new asn1js.Sequence({
    value: [
      new asn1js.Integer({ valueHex: padIntegerForAsn1(r) }),
      new asn1js.Integer({ valueHex: padIntegerForAsn1(s) }),
    ],
  });
  return seq.toBER(false);
}

/**
 * Pad a positive bignum for ASN.1 INTEGER encoding:
 *   - strip leading zeros (asn1js encodes minimally),
 *   - if MSB is set, prepend a 0x00 to keep it positive.
 */
function padIntegerForAsn1(bn: Uint8Array): ArrayBuffer {
  let i = 0;
  while (i < bn.length - 1 && bn[i] === 0) i++;
  const trimmed = bn.subarray(i);
  if (trimmed.length === 0 || (trimmed[0] !== undefined && trimmed[0] >= 0x80)) {
    const padded = new Uint8Array(trimmed.length + 1);
    padded[0] = 0;
    padded.set(trimmed, 1);
    return padded.buffer.slice(padded.byteOffset, padded.byteOffset + padded.byteLength) as ArrayBuffer;
  }
  return trimmed.buffer.slice(trimmed.byteOffset, trimmed.byteOffset + trimmed.byteLength) as ArrayBuffer;
}
