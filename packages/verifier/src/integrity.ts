import { type HashAlgo, digest } from '@firma-ec/crypto-core';
import { REJECTED_HASH_OIDS, REJECTED_SIG_OIDS } from '@firma-ec/crypto-core';
import type { Certificate } from 'pkijs';
import { ERR_RSA_TOO_SMALL, ERR_WEAK_HASH, ERR_WEAK_SIG, VerificationError } from './errors';
import type { IntegrityCheck } from './result';

const HASH_OID_TO_ALGO: Record<string, HashAlgo> = {
  '2.16.840.1.101.3.4.2.1': 'SHA-256',
  '2.16.840.1.101.3.4.2.2': 'SHA-384',
  '2.16.840.1.101.3.4.2.3': 'SHA-512',
};

/** SHA-1 hash OID + sha1WithRSA signature OID (legacy, weak — only the
 *  no-signedAttrs path opts in, to read existing BCE-signed gov documents). */
const SHA1_HASH_OID = '1.3.14.3.2.26';
const SHA1_RSA_SIG_OID = '1.2.840.113549.1.1.5';

/** Build a synthetic Uint8Array equivalent to the PDF with /Contents bytes zeroed out. */
export function buildCoveredBytes(
  pdfBytes: Uint8Array,
  byteRange: [number, number, number, number],
): Uint8Array {
  const [a, b, c, d] = byteRange;
  const out = new Uint8Array(b + d);
  out.set(pdfBytes.subarray(a, a + b), 0);
  out.set(pdfBytes.subarray(c, c + d), b);
  return out;
}

/** Hash the bytes covered by /ByteRange and compare against the embedded messageDigest. */
export async function checkDocumentIntegrity(
  pdfBytes: Uint8Array,
  byteRange: [number, number, number, number],
  digestAlgoOid: string,
  expectedDigest: Uint8Array,
): Promise<{ matches: boolean; computed: Uint8Array }> {
  if (REJECTED_HASH_OIDS.has(digestAlgoOid)) {
    throw new VerificationError(ERR_WEAK_HASH, `Rejected weak hash algorithm OID ${digestAlgoOid}`);
  }
  const algo = HASH_OID_TO_ALGO[digestAlgoOid];
  if (!algo) {
    throw new VerificationError(ERR_WEAK_HASH, `Unsupported hash algorithm OID ${digestAlgoOid}`);
  }

  const covered = buildCoveredBytes(pdfBytes, byteRange);
  const computed = await digest(algo, covered);

  if (computed.length !== expectedDigest.length) return { matches: false, computed };
  let same = true;
  for (let i = 0; i < computed.length; i++)
    if (computed[i] !== expectedDigest[i]) {
      same = false;
      break;
    }
  return { matches: same, computed };
}

/**
 * Verify the signature value over `signedData` using the signer cert's public
 * key. `signedData` is the DER-encoded signedAttrs (PAdES-B-B) OR, for the bare
 * CAdES-BES profile without signed attributes, the eContent itself (the
 * /ByteRange-covered bytes).
 *
 * `opts.allowSha1` opts this call into accepting SHA-1 / sha1WithRSA — used
 * ONLY for the no-signedAttrs legacy profile so firmar.ec can read existing
 * SHA-1-signed Ecuadorian government documents (BCE). The default policy still
 * hard-rejects SHA-1.
 */
export async function verifySignatureValue(
  signerCert: Certificate,
  signatureAlgoOid: string,
  digestAlgoOid: string,
  signedData: Uint8Array,
  signatureValue: Uint8Array,
  opts: { allowSha1?: boolean } = {},
): Promise<boolean> {
  const sha1Ok = opts.allowSha1 === true;
  if (
    REJECTED_SIG_OIDS.has(signatureAlgoOid) &&
    !(sha1Ok && signatureAlgoOid === SHA1_RSA_SIG_OID)
  ) {
    throw new VerificationError(
      ERR_WEAK_SIG,
      `Rejected weak signature algorithm OID ${signatureAlgoOid}`,
    );
  }

  // Determine the Web Crypto hash name. SHA-1 is only resolvable when the caller
  // explicitly opted in (no-signedAttrs legacy path); otherwise it stays rejected.
  let hashAlgo: HashAlgo | 'SHA-1' | undefined = HASH_OID_TO_ALGO[digestAlgoOid];
  if (!hashAlgo && sha1Ok && digestAlgoOid === SHA1_HASH_OID) hashAlgo = 'SHA-1';
  if (!hashAlgo)
    throw new VerificationError(
      ERR_WEAK_HASH,
      `Unsupported hash OID for signature: ${digestAlgoOid}`,
    );

  const isRsa =
    signatureAlgoOid === '1.2.840.113549.1.1.11' ||
    signatureAlgoOid === '1.2.840.113549.1.1.12' ||
    signatureAlgoOid === '1.2.840.113549.1.1.13' ||
    signatureAlgoOid === '1.2.840.113549.1.1.1' ||
    // sha1WithRSAEncryption — only reached when the caller opted into SHA-1
    // (no-signedAttrs legacy path); the digest used is taken from digestAlgoOid.
    (sha1Ok && signatureAlgoOid === SHA1_RSA_SIG_OID);
  const isRsaPss = signatureAlgoOid === '1.2.840.113549.1.1.10';
  const isEcdsa =
    signatureAlgoOid === '1.2.840.10045.4.3.2' || signatureAlgoOid === '1.2.840.10045.4.3.3';

  // Export pubkey from signer cert — copy into a fresh ArrayBuffer (required by SubtleCrypto)
  const spkiRaw = new Uint8Array(signerCert.subjectPublicKeyInfo.toSchema().toBER(false));
  const spkiDer: ArrayBuffer = spkiRaw.buffer.slice(
    spkiRaw.byteOffset,
    spkiRaw.byteOffset + spkiRaw.byteLength,
  ) as ArrayBuffer;

  // Helper to copy a Uint8Array into a plain ArrayBuffer (avoids SharedArrayBuffer overload rejection)
  function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
  }

  if (isRsa) {
    const pubkey = await crypto.subtle.importKey(
      'spki',
      spkiDer,
      { name: 'RSASSA-PKCS1-v1_5', hash: hashAlgo },
      false,
      ['verify'],
    );
    // RSA-2048 minimum (modulus length in bits)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const modulusHex = (signerCert.subjectPublicKeyInfo.parsedKey as any)?.modulus?.valueBlock
      ?.valueHex as ArrayBuffer | undefined;
    const modulusBits = modulusHex ? modulusHex.byteLength * 8 : undefined;
    if (modulusBits && modulusBits < 2048) {
      throw new VerificationError(
        ERR_RSA_TOO_SMALL,
        `RSA modulus too small: ${modulusBits} bits (need ≥2048)`,
      );
    }
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      pubkey,
      toArrayBuffer(signatureValue),
      toArrayBuffer(signedData),
    );
  }

  if (isRsaPss) {
    // saltLength typically equals digest length for PSS-with-MGF1
    const saltLength = hashAlgo === 'SHA-256' ? 32 : hashAlgo === 'SHA-384' ? 48 : 64;
    const pubkey = await crypto.subtle.importKey(
      'spki',
      spkiDer,
      { name: 'RSA-PSS', hash: hashAlgo },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      { name: 'RSA-PSS', saltLength },
      pubkey,
      toArrayBuffer(signatureValue),
      toArrayBuffer(signedData),
    );
  }

  if (isEcdsa) {
    const namedCurve = hashAlgo === 'SHA-256' ? 'P-256' : 'P-384';
    const pubkey = await crypto.subtle.importKey(
      'spki',
      spkiDer,
      { name: 'ECDSA', namedCurve },
      false,
      ['verify'],
    );
    // CMS encodes ECDSA signature as ASN.1 SEQUENCE { r INTEGER, s INTEGER }; Web Crypto expects raw r||s
    const rsBytes = await asn1ToRawEcdsa(signatureValue, hashAlgo === 'SHA-256' ? 32 : 48);
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: hashAlgo },
      pubkey,
      toArrayBuffer(rsBytes),
      toArrayBuffer(signedData),
    );
  }

  throw new VerificationError(
    ERR_WEAK_SIG,
    `Unsupported signature algorithm OID ${signatureAlgoOid}`,
  );
}

async function asn1ToRawEcdsa(asn1Sig: Uint8Array, fieldBytes: number): Promise<Uint8Array> {
  const { fromBER } = await import('asn1js');
  const parsed = fromBER(
    asn1Sig.buffer.slice(
      asn1Sig.byteOffset,
      asn1Sig.byteOffset + asn1Sig.byteLength,
    ) as ArrayBuffer,
  );
  if (parsed.offset === -1) throw new Error('ECDSA ASN.1 decode failed');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const seq = (parsed.result as any).valueBlock.value as {
    valueBlock: { valueHex: ArrayBuffer };
  }[];
  const r = new Uint8Array(seq[0]!.valueBlock.valueHex);
  const s = new Uint8Array(seq[1]!.valueBlock.valueHex);
  const out = new Uint8Array(fieldBytes * 2);
  out.set(stripPad(r, fieldBytes), fieldBytes - stripPad(r, fieldBytes).length);
  out.set(stripPad(s, fieldBytes), fieldBytes * 2 - stripPad(s, fieldBytes).length);
  return out;
}

function stripPad(b: Uint8Array, target: number): Uint8Array {
  let i = 0;
  while (i < b.length && b[i] === 0 && b.length - i > target) i++;
  return b.subarray(i);
}

export async function buildIntegrityResult(args: {
  documentMatches: boolean;
  signatureValid: boolean;
  hasIncrementalUpdates: boolean;
  coveredBytes: number;
  totalBytes: number;
}): Promise<IntegrityCheck> {
  return {
    digestMatches: args.documentMatches,
    hasIncrementalUpdates: args.hasIncrementalUpdates,
    coveredBytes: args.coveredBytes,
    totalBytes: args.totalBytes,
  };
}
