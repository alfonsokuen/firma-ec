/**
 * CertID normalization helpers — RFC 6960 §4.1.1.
 *
 * A CertID's `serialNumber` is a DER INTEGER. Two encoders can legally emit
 * different byte strings for the SAME integer: one may echo the subject
 * cert's serial verbatim (possibly carrying a leading 0x00 pad byte the DER
 * INTEGER rule requires whenever the high bit of the first byte would
 * otherwise read as negative), another may re-encode it minimally. Comparing
 * the raw hex would reject a numerically-identical serial for cosmetic
 * reasons. Stripping leading zero *byte pairs* — never digits, never past a
 * single remaining byte — collapses both encodings to the same string without
 * ever conflating two distinct positive integers (removing leading zero
 * bytes from a non-negative integer's big-endian representation is a
 * bijection), so the normalization costs nothing in security.
 */

const HASH_ALGO_OID_SHA1 = '1.3.14.3.2.26';
const HASH_ALGO_OID_SHA256 = '2.16.840.1.101.3.4.2.1';

export type CertIdHashAlgo = 'sha1' | 'sha256' | 'other';

/**
 * Lowercase the hex string and strip leading `00` byte-pairs, keeping at
 * least one byte (so `'00'` stays `'00'`, never becomes empty).
 */
export function normalizeSerialHex(hex: string): string {
  let h = hex.toLowerCase();
  while (h.length > 2 && h.startsWith('00')) {
    h = h.slice(2);
  }
  return h;
}

/** Map a CertID `hashAlgorithm` OID to the algorithm family we recognize. */
export function certIdHashAlgoFromOid(oid: string): CertIdHashAlgo {
  if (oid === HASH_ALGO_OID_SHA1) return 'sha1';
  if (oid === HASH_ALGO_OID_SHA256) return 'sha256';
  return 'other';
}
