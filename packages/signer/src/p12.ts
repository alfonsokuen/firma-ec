/**
 * PKCS#12 (.p12 / .pfx) parsing for @firma-ec/signer.
 *
 * v0.4.3 — switched decryption backend pkijs → node-forge to support legacy
 * `pbeWithSHAAnd3-KeyTripleDES-CBC` (3DES) cipher. ALL Ecuadorian ECIs
 * (BCE, Security Data, ArgosData, ANFAC, ConsejoJudicatura) emit .p12 files
 * with this legacy PBE/3DES — pkijs delegates symmetric crypto to Web Crypto API
 * which does NOT expose 3DES, causing `pfx_unsupported_algo` on every real-world
 * Ecuadorian PKCS#12. node-forge ships a pure-JS implementation of 3DES + AES +
 * the full PKCS#12 cipher matrix.
 *
 * Pipeline:
 *   1. node-forge decrypts PFX (3DES, AES-CBC, RC2-CBC, etc) and yields
 *      cert bags + key bags as forge objects.
 *   2. We extract the signer cert as DER bytes and build SignerCert.
 *   3. For RSA private keys: forge gives us a typed key; we wrap to PKCS#8 DER.
 *   4. For ECDSA private keys: forge can't model EC keys but exposes the raw
 *      decrypted ASN.1 of the bag — we re-emit that ASN.1 as PKCS#8 DER.
 *
 * Privacy: 100% client-side. node-forge runs as pure JS; nothing leaves the
 * browser. The .p12 bytes + PIN never reach a network.
 *
 * @see docs/superpowers/specs/2026-05-09-firma-ec-F3-firma-MVP-design.md §4.1
 */

import * as asn1js from 'asn1js';
import forge from 'node-forge';
import { SignerError } from './errors.js';
import type { ParsedPfx, SigAlg, SignerCert } from './types.js';

/** OIDs we care about. */
const OID_RSA_ENCRYPTION = '1.2.840.113549.1.1.1';
const OID_EC_PUBLIC_KEY = '1.2.840.10045.2.1';

/** Named curve OIDs → ECDSA suite. */
const EC_CURVE_OIDS: Record<string, { sigAlg: SigAlg; hash: 'SHA-256' | 'SHA-384' | 'SHA-512' }> = {
  '1.2.840.10045.3.1.7': { sigAlg: 'ECDSA-P256-SHA256', hash: 'SHA-256' }, // P-256
  '1.3.132.0.34': { sigAlg: 'ECDSA-P384-SHA384', hash: 'SHA-384' }, // P-384
  '1.3.132.0.35': { sigAlg: 'ECDSA-P521-SHA512', hash: 'SHA-512' }, // P-521
};

/** Convert a Uint8Array → forge ByteStringBuffer (binary string). */
function bytesToForgeBuffer(bytes: Uint8Array): forge.util.ByteStringBuffer {
  // Building a binary string char-by-char preserves every byte 1:1 (no UTF-8 expansion).
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i] as number);
  }
  // node-forge's createBuffer accepts a binary string when no encoding is given.
  return forge.util.createBuffer(s);
}

/** Forge binary-string → Uint8Array. */
function forgeBytesToUint8(bin: string): Uint8Array {
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

/** Extract CN from a forge cert subject/issuer. */
function forgeCN(rdn: forge.pki.Certificate['subject']): string {
  // forge provides .getField('CN') → AttributeShortName
  const f = rdn.getField('CN') as { value?: string } | null;
  return f?.value ?? '';
}

/** Render forge cert serial number (already hex string in forge) as uppercase no-0x. */
function forgeSerialHex(cert: forge.pki.Certificate): string {
  // forge gives serialNumber as a lowercase hex string (sometimes with leading 0).
  // Strip any leading 0 pairs ONLY if they don't change the value (preserve full byte width).
  return cert.serialNumber.toUpperCase();
}

/** Build SignerCert (our public type) from a forge cert. */
function toSignerCert(cert: forge.pki.Certificate): SignerCert {
  const certAsn1 = forge.pki.certificateToAsn1(cert);
  const derBin = forge.asn1.toDer(certAsn1).getBytes();
  const der = forgeBytesToUint8(derBin);
  return {
    der,
    subjectCN: forgeCN(cert.subject),
    issuerCN: forgeCN(cert.issuer),
    notBefore: cert.validity.notBefore,
    notAfter: cert.validity.notAfter,
    serialHex: forgeSerialHex(cert),
  };
}

/* ─────────────────────────────────────────────────────────────────────
 * ECDSA fallback: when forge cannot model an EC cert/key, work directly
 * with the raw ASN.1 / DER bytes via asn1js.
 *
 * This keeps RSA happy paths on the fast forge route while ensuring full
 * coverage for ECDSA P-256 / P-384 (P-521 marked unsupported below).
 * ────────────────────────────────────────────────────────────────── */

/** Read SPKI algorithm OID + curveOid from a cert DER buffer (asn1js path). */
function readSpkiAlgorithmFromDer(certDer: Uint8Array): { algOid: string; curveOid?: string } {
  const buf = new ArrayBuffer(certDer.byteLength);
  new Uint8Array(buf).set(certDer);
  const parsed = asn1js.fromBER(buf);
  if (parsed.offset === -1) {
    throw new SignerError('pfx_corrupt', 'Cert DER reparse failed (asn1js)');
  }
  const certSeq = parsed.result as asn1js.Sequence;
  const tbs = certSeq.valueBlock.value[0] as asn1js.Sequence;
  if (!tbs) throw new SignerError('pfx_corrupt', 'Cert missing tbsCertificate');

  let spki: asn1js.Sequence | undefined;
  for (const child of tbs.valueBlock.value) {
    const blk = child as asn1js.BaseBlock & { idBlock: { tagClass: number; tagNumber: number } };
    if (blk.idBlock.tagClass !== 1 || blk.idBlock.tagNumber !== 16) continue;
    const seq = child as asn1js.Sequence;
    const first = seq.valueBlock.value[0] as asn1js.BaseBlock | undefined;
    if (!first) continue;
    const firstId = (first as { idBlock: { tagClass: number; tagNumber: number } }).idBlock;
    if (firstId.tagClass !== 1 || firstId.tagNumber !== 16) continue;
    const firstSeq = first as asn1js.Sequence;
    const innerOidNode = firstSeq.valueBlock.value[0] as asn1js.BaseBlock | undefined;
    if (!innerOidNode) continue;
    const innerId = (innerOidNode as { idBlock: { tagClass: number; tagNumber: number } }).idBlock;
    if (innerId.tagClass === 1 && innerId.tagNumber === 6) {
      spki = seq;
      break;
    }
  }
  if (!spki) throw new SignerError('pfx_corrupt', 'Could not locate SPKI in cert');

  const algIdSeq = spki.valueBlock.value[0] as asn1js.Sequence;
  const algOidNode = algIdSeq.valueBlock.value[0] as asn1js.ObjectIdentifier;
  const algOid = algOidNode.valueBlock.toString();

  if (algOid === OID_EC_PUBLIC_KEY) {
    const params = algIdSeq.valueBlock.value[1] as asn1js.BaseBlock | undefined;
    if (
      params &&
      (params as { idBlock: { tagClass: number; tagNumber: number } }).idBlock.tagNumber === 6
    ) {
      return { algOid, curveOid: (params as asn1js.ObjectIdentifier).valueBlock.toString() };
    }
  }
  return { algOid };
}

/** Extract a printable CN string from a Name (asn1js Sequence of RDN SETs). */
function readCnFromName(name: asn1js.Sequence): string {
  const CN_OID = '2.5.4.3';
  for (const rdn of name.valueBlock.value) {
    // RDN ::= SET OF AttributeTypeAndValue
    const rdnSet = rdn as asn1js.Set;
    for (const atv of rdnSet.valueBlock.value) {
      // AttributeTypeAndValue ::= SEQUENCE { type OID, value ANY }
      const atvSeq = atv as asn1js.Sequence;
      const typeNode = atvSeq.valueBlock.value[0] as asn1js.ObjectIdentifier;
      if (typeNode.valueBlock.toString() === CN_OID) {
        const valueNode = atvSeq.valueBlock.value[1] as asn1js.BaseBlock & {
          valueBlock: { value?: string };
        };
        return valueNode.valueBlock.value ?? '';
      }
    }
  }
  return '';
}

/** Build SignerCert from raw cert ASN.1 (used when forge can't parse the cert — e.g. ECDSA). */
function signerCertFromDer(certDer: Uint8Array): SignerCert {
  const buf = new ArrayBuffer(certDer.byteLength);
  new Uint8Array(buf).set(certDer);
  const parsed = asn1js.fromBER(buf);
  if (parsed.offset === -1) throw new SignerError('pfx_corrupt', 'Cert DER reparse failed');
  const certSeq = parsed.result as asn1js.Sequence;
  const tbs = certSeq.valueBlock.value[0] as asn1js.Sequence;

  // tbsCertificate fields (when version present as [0] EXPLICIT INTEGER):
  //   [0] version, serialNumber, signature, issuer, validity, subject, SPKI, …
  // Skip the optional [0] EXPLICIT version tag.
  const tbsChildren = tbs.valueBlock.value;
  let idx = 0;
  const first = tbsChildren[0] as asn1js.BaseBlock & { idBlock: { tagClass: number } };
  if (first && first.idBlock.tagClass === 3 /* CONTEXT-SPECIFIC */) idx = 1;

  const serialNode = tbsChildren[idx++] as asn1js.Integer;
  // signature (algorithmIdentifier) — skip
  idx++;
  const issuerNode = tbsChildren[idx++] as asn1js.Sequence;
  const validityNode = tbsChildren[idx++] as asn1js.Sequence;
  const subjectNode = tbsChildren[idx++] as asn1js.Sequence;

  const subjectCN = readCnFromName(subjectNode);
  const issuerCN = readCnFromName(issuerNode);

  // Validity ::= SEQUENCE { notBefore Time, notAfter Time }
  // Time ::= CHOICE { utcTime UTCTime, generalTime GeneralizedTime }
  const notBeforeNode = validityNode.valueBlock.value[0] as asn1js.BaseBlock & {
    toDate?: () => Date;
    valueBlock: { valueDate?: Date; value?: string };
  };
  const notAfterNode = validityNode.valueBlock.value[1] as asn1js.BaseBlock & {
    toDate?: () => Date;
    valueBlock: { valueDate?: Date; value?: string };
  };
  // asn1js >=3 exposes toDate(); fall back to valueDate field.
  const notBefore =
    typeof notBeforeNode.toDate === 'function'
      ? notBeforeNode.toDate()
      : (notBeforeNode.valueBlock.valueDate as Date);
  const notAfter =
    typeof notAfterNode.toDate === 'function'
      ? notAfterNode.toDate()
      : (notAfterNode.valueBlock.valueDate as Date);

  // Serial as uppercase hex (no leading 0x).
  const serialBytes = new Uint8Array(serialNode.valueBlock.valueHexView);
  let serialHex = '';
  for (let i = 0; i < serialBytes.length; i++) {
    serialHex += serialBytes[i]!.toString(16).padStart(2, '0');
  }
  serialHex = serialHex.toUpperCase().replace(/^0+(?=[0-9A-F])/, '') || '0';

  return {
    der: certDer,
    subjectCN,
    issuerCN,
    notBefore,
    notAfter,
    serialHex,
  };
}

/**
 * Read the SubjectPublicKeyInfo's algorithm OID from a forge cert.
 *
 * Strategy: re-emit the cert as DER and parse the SPKI with asn1js, which gives
 * us a robust path-independent walk (no need to reason about OPTIONAL version
 * fields or how forge serialised them).
 *
 * Returns the algorithm OID and (if EC) the namedCurve OID.
 */
function readSpkiAlgorithm(cert: forge.pki.Certificate): {
  algOid: string;
  curveOid?: string;
} {
  const certAsn1 = forge.pki.certificateToAsn1(cert);
  const derBin = forge.asn1.toDer(certAsn1).getBytes();
  const u8 = forgeBytesToUint8(derBin);
  const buf = new ArrayBuffer(u8.byteLength);
  new Uint8Array(buf).set(u8);

  const parsed = asn1js.fromBER(buf);
  if (parsed.offset === -1) {
    throw new SignerError('pfx_corrupt', 'Cert DER reparse failed (asn1js)');
  }
  // Certificate ::= SEQUENCE { tbsCertificate, sigAlg, sigValue }
  const certSeq = parsed.result as asn1js.Sequence;
  const tbs = certSeq.valueBlock.value[0] as asn1js.Sequence;
  if (!tbs) throw new SignerError('pfx_corrupt', 'Cert missing tbsCertificate');

  // Find SubjectPublicKeyInfo: it's the SEQUENCE whose first child is itself a
  // SEQUENCE whose first child is an OBJECT IDENTIFIER (= AlgorithmIdentifier).
  // Among tbs children, SPKI is the SEQUENCE before any [n] EXPLICIT extensions.
  // Simpler: SPKI is the LAST tbs child that is a plain SEQUENCE (issuerUID/
  // subjectUID are BIT STRINGs and extensions are [3] EXPLICIT). Walk all
  // candidates and pick the SEQUENCE whose first child is SEQUENCE→OID.
  let spki: asn1js.Sequence | undefined;
  for (const child of tbs.valueBlock.value) {
    // Only universal SEQUENCEs are candidates (skip context-specific [0] version,
    // [1]/[2] UIDs, [3] extensions).
    const blk = child as asn1js.BaseBlock & { idBlock: { tagClass: number; tagNumber: number } };
    if (blk.idBlock.tagClass !== 1 /* UNIVERSAL */ || blk.idBlock.tagNumber !== 16 /* SEQUENCE */)
      continue;
    const seq = child as asn1js.Sequence;
    const first = seq.valueBlock.value[0] as asn1js.BaseBlock | undefined;
    if (!first) continue;
    const firstId = (first as { idBlock: { tagClass: number; tagNumber: number } }).idBlock;
    if (firstId.tagClass !== 1 || firstId.tagNumber !== 16) continue;
    // first is a SEQUENCE — check that ITS first child is an OBJECT IDENTIFIER
    const firstSeq = first as asn1js.Sequence;
    const innerOidNode = firstSeq.valueBlock.value[0] as asn1js.BaseBlock | undefined;
    if (!innerOidNode) continue;
    const innerId = (innerOidNode as { idBlock: { tagClass: number; tagNumber: number } }).idBlock;
    if (innerId.tagClass === 1 && innerId.tagNumber === 6 /* OID */) {
      // SPKI is the unique SEQUENCE in tbsCertificate whose first child is a
      // SEQUENCE-of-OID (= AlgorithmIdentifier). Other tbs SEQUENCEs (issuer,
      // subject) contain SET as first child, not SEQUENCE. `signature` is
      // SEQUENCE whose first child is OID directly (not SEQUENCE). So this
      // matches exactly SPKI.
      spki = seq;
      break;
    }
  }
  if (!spki) {
    throw new SignerError('pfx_corrupt', 'Could not locate SubjectPublicKeyInfo in cert');
  }

  const algIdSeq = spki.valueBlock.value[0] as asn1js.Sequence;
  const algOidNode = algIdSeq.valueBlock.value[0] as asn1js.ObjectIdentifier;
  const algOid = algOidNode.valueBlock.toString();

  if (algOid === OID_EC_PUBLIC_KEY) {
    const params = algIdSeq.valueBlock.value[1] as asn1js.BaseBlock | undefined;
    if (
      params &&
      (params as { idBlock: { tagClass: number; tagNumber: number } }).idBlock.tagNumber === 6
    ) {
      return { algOid, curveOid: (params as asn1js.ObjectIdentifier).valueBlock.toString() };
    }
  }
  return { algOid };
}

/** Map cert SPKI → SigAlg for our sigAlg field. */
function inferSigAlgFromCert(cert: forge.pki.Certificate): SigAlg {
  const { algOid, curveOid } = readSpkiAlgorithm(cert);
  if (algOid === OID_RSA_ENCRYPTION) {
    // Default to RSA-PKCS1 SHA-256 (PSS would require explicit policy).
    return 'RSA-PKCS1-SHA256';
  }
  if (algOid === OID_EC_PUBLIC_KEY) {
    if (curveOid && EC_CURVE_OIDS[curveOid]) {
      return EC_CURVE_OIDS[curveOid].sigAlg;
    }
    return 'ECDSA-P256-SHA256';
  }
  throw new SignerError('pfx_unsupported_algo', `Unsupported SPKI algorithm OID ${algOid}`);
}

/**
 * Wrap an RSA private key (forge object) into PKCS#8 DER.
 * forge.pki.wrapRsaPrivateKey takes the PKCS#1 RSAPrivateKey ASN.1 and produces
 * the PKCS#8 PrivateKeyInfo ASN.1.
 */
function rsaPrivateKeyToPkcs8Der(key: forge.pki.rsa.PrivateKey): ArrayBuffer {
  const rsaPrivateKeyAsn1 = forge.pki.privateKeyToAsn1(key);
  const pkcs8Asn1 = forge.pki.wrapRsaPrivateKey(rsaPrivateKeyAsn1);
  const der = forge.asn1.toDer(pkcs8Asn1).getBytes();
  const u8 = forgeBytesToUint8(der);
  // Always return a fresh ArrayBuffer (never a SharedArrayBuffer).
  const buf = new ArrayBuffer(u8.byteLength);
  new Uint8Array(buf).set(u8);
  return buf;
}

/**
 * For ECDSA: forge cannot construct a typed key, but `bag.asn1` is the
 * decrypted PrivateKeyInfo (PKCS#8) ASN.1 directly. We just re-emit it as DER.
 */
function rawAsn1ToPkcs8Der(asn1Node: forge.asn1.Asn1): ArrayBuffer {
  const der = forge.asn1.toDer(asn1Node).getBytes();
  const u8 = forgeBytesToUint8(der);
  const buf = new ArrayBuffer(u8.byteLength);
  new Uint8Array(buf).set(u8);
  return buf;
}

/**
 * Heuristic to pick the signer cert when the PFX has a chain.
 * Strategy: prefer certs with non-empty subjectKeyIdentifier-vs-authorityKeyIdentifier
 * mismatch (= leaf, not self-signed CA). If unavailable, prefer the first non-CA
 * cert (basicConstraints CA:false). Fall back to first cert.
 */
function pickSignerCert(certs: forge.pki.Certificate[]): forge.pki.Certificate {
  if (certs.length === 1) {
    return certs[0] as forge.pki.Certificate;
  }
  // Try to find a cert that is NOT a CA (basicConstraints CA:false or absent and self-signed).
  for (const c of certs) {
    const bc = c.getExtension('basicConstraints') as { cA?: boolean } | null;
    if (bc && bc.cA === false) return c;
  }
  return certs[0] as forge.pki.Certificate;
}

/** Convert a string PIN as forge expects (binary string OK; forge handles BMP encoding). */
function pinForForge(pin: string): string {
  return pin;
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
  // ── 1. Parse outer PFX from DER bytes (via forge) ───────────────────
  if (!pfxBytes || pfxBytes.byteLength === 0) {
    throw new SignerError('pfx_corrupt', 'PFX bytes are empty');
  }

  let pfxAsn1: forge.asn1.Asn1;
  try {
    const buf = bytesToForgeBuffer(pfxBytes);
    pfxAsn1 = forge.asn1.fromDer(buf, /* strict */ false);
  } catch (cause) {
    throw new SignerError('pfx_corrupt', 'Failed to BER-decode PFX bytes', cause);
  }

  // ── 2. Decrypt + walk PFX with forge (handles 3DES, AES, RC2) ───────
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, /* strict */ false, pinForForge(pin));
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    // forge surfaces wrong-PIN as MAC verification failure or "Invalid password".
    if (/MAC could not be verified|Invalid password|PKCS#12 MAC|integrity/i.test(msg)) {
      throw new SignerError('pin_invalid', 'PKCS#12 MAC verification failed (wrong PIN?)', cause);
    }
    // Unsupported cipher (would be unusual now that we have 3DES/AES) → unsupported_algo.
    if (/Unsupported|cipher|algorithm|OID/i.test(msg)) {
      throw new SignerError('pfx_unsupported_algo', `Unsupported PFX cipher: ${msg}`, cause);
    }
    // Default: structural failure.
    throw new SignerError('pfx_corrupt', `Failed to parse PFX: ${msg}`, cause);
  }

  // ── 3. Extract certs + private key from bags ────────────────────────
  // forge.pki.oids is an index signature; bracket-access avoids TS4111.
  const CERT_BAG_OID = forge.pki.oids['certBag'] ?? '1.2.840.113549.1.12.10.1.3';
  const SHROUDED_KEY_BAG_OID =
    forge.pki.oids['pkcs8ShroudedKeyBag'] ?? '1.2.840.113549.1.12.10.1.2';
  const KEY_BAG_OID = forge.pki.oids['keyBag'] ?? '1.2.840.113549.1.12.10.1.1';

  const certBagsMap = p12.getBags({ bagType: CERT_BAG_OID });
  const certBags = certBagsMap[CERT_BAG_OID] ?? [];

  const shroudedKeyBagsMap = p12.getBags({ bagType: SHROUDED_KEY_BAG_OID });
  const shroudedKeyBags = shroudedKeyBagsMap[SHROUDED_KEY_BAG_OID] ?? [];

  const keyBagsMap = p12.getBags({ bagType: KEY_BAG_OID });
  const plainKeyBags = keyBagsMap[KEY_BAG_OID] ?? [];

  const allKeyBags = [...shroudedKeyBags, ...plainKeyBags];

  // Cert bags may have either bag.cert (RSA — forge parsed it) or bag.asn1
  // (ECDSA / unknown sigAlg — forge stashed the raw ASN.1 because
  // certificateFromAsn1 threw). Collect both representations.
  type CertEntry =
    | { kind: 'forge'; cert: forge.pki.Certificate; der: Uint8Array }
    | { kind: 'raw'; der: Uint8Array };

  const certEntries: CertEntry[] = [];
  for (const cb of certBags) {
    if (cb.cert) {
      const certAsn1 = forge.pki.certificateToAsn1(cb.cert);
      const derBin = forge.asn1.toDer(certAsn1).getBytes();
      certEntries.push({ kind: 'forge', cert: cb.cert, der: forgeBytesToUint8(derBin) });
    } else if (cb.asn1) {
      const derBin = forge.asn1.toDer(cb.asn1).getBytes();
      certEntries.push({ kind: 'raw', der: forgeBytesToUint8(derBin) });
    }
  }

  if (certEntries.length === 0) {
    throw new SignerError('no_signing_cert', 'No certificate found in PFX');
  }
  if (allKeyBags.length === 0) {
    throw new SignerError('no_signing_cert', 'No private key found in PFX');
  }

  const keyBag = allKeyBags[0] as forge.pkcs12.Bag;

  // ── 4. Pick signer cert (leaf, not CA) ──────────────────────────────
  // If we have at least one forge cert, prefer leaf-by-basicConstraints among
  // forge certs. Otherwise (all-EC PFX) pick the first raw entry.
  const forgeCerts = certEntries
    .filter((e): e is Extract<CertEntry, { kind: 'forge' }> => e.kind === 'forge')
    .map((e) => e.cert);
  let signerEntry: CertEntry;
  if (forgeCerts.length > 0) {
    const signerForgeCert = pickSignerCert(forgeCerts);
    signerEntry = certEntries.find(
      (e) => e.kind === 'forge' && e.cert === signerForgeCert,
    ) as CertEntry;
  } else {
    signerEntry = certEntries[0] as CertEntry;
  }
  const intermediateEntries = certEntries.filter((e) => e !== signerEntry);

  // Build SignerCert objects (works regardless of forge vs raw).
  const signingCert: SignerCert =
    signerEntry.kind === 'forge'
      ? toSignerCert(signerEntry.cert)
      : signerCertFromDer(signerEntry.der);
  const intermediates: SignerCert[] = intermediateEntries.map((e) =>
    e.kind === 'forge' ? toSignerCert(e.cert) : signerCertFromDer(e.der),
  );

  // ── 5. Infer sigAlg from the SIGNER cert's SPKI ──────────────────────
  // Use the DER-based reader uniformly so RSA + ECDSA paths converge.
  const sigAlgInfo = readSpkiAlgorithmFromDer(signerEntry.der);
  let sigAlg: SigAlg;
  if (sigAlgInfo.algOid === OID_RSA_ENCRYPTION) {
    sigAlg = 'RSA-PKCS1-SHA256';
  } else if (sigAlgInfo.algOid === OID_EC_PUBLIC_KEY) {
    if (sigAlgInfo.curveOid === '1.3.132.0.35') {
      // P-521 — Web Crypto supports it but our SigAlg union covers it; we
      // accept it here. If a downstream signer rejects it, that's a separate
      // policy decision (matches RSA-1024-weak handling).
      sigAlg = 'ECDSA-P521-SHA512';
    } else if (sigAlgInfo.curveOid && EC_CURVE_OIDS[sigAlgInfo.curveOid]) {
      const entry = EC_CURVE_OIDS[sigAlgInfo.curveOid];
      sigAlg = entry!.sigAlg;
    } else {
      sigAlg = 'ECDSA-P256-SHA256';
    }
  } else {
    throw new SignerError(
      'pfx_unsupported_algo',
      `Unsupported SPKI algorithm OID ${sigAlgInfo.algOid}`,
    );
  }

  // ── 6. Build PKCS#8 DER from the private key ────────────────────────
  let privateKeyPkcs8Der: ArrayBuffer;
  let kty: 'RSA' | 'EC';

  if (keyBag.key) {
    // forge produced a typed key — must be RSA (forge has no EC key model).
    privateKeyPkcs8Der = rsaPrivateKeyToPkcs8Der(keyBag.key);
    kty = 'RSA';
  } else if (keyBag.asn1) {
    // No typed key — happens for ECDSA. Emit the decrypted ASN.1 (already
    // PKCS#8 PrivateKeyInfo for shroudedKeyBag, or PrivateKeyInfo for keyBag) as DER.
    privateKeyPkcs8Der = rawAsn1ToPkcs8Der(keyBag.asn1);
    kty = sigAlgInfo.algOid === OID_EC_PUBLIC_KEY ? 'EC' : 'RSA';
  } else {
    throw new SignerError('pfx_corrupt', 'Key bag has neither typed key nor raw ASN.1');
  }

  // ── 7. Cross-check: verify privateKeyPkcs8Der parses ─────────────────
  // (Catch malformed PKCS#8 early so pades.ts importPrivateKey doesn't blow up
  // with a less helpful Web Crypto error.)
  try {
    const verifyAsn1 = asn1js.fromBER(privateKeyPkcs8Der);
    if (verifyAsn1.offset === -1) {
      throw new Error('PKCS#8 ASN.1 reparse failed');
    }
  } catch (cause) {
    throw new SignerError('pfx_corrupt', 'Built private key bytes are not valid PKCS#8 DER', cause);
  }

  // ── 8. Build minimal JWK (kty only; full key never leaves PKCS#8) ────
  // Same contract as v0.4.2: callers should use privateKeyPkcs8Der + crypto.subtle.importKey('pkcs8',…).
  const privateKeyJwk: JsonWebKey = { kty };

  const result: ParsedPfx & { privateKeyPkcs8Der: ArrayBuffer } = {
    signingCert,
    intermediates,
    privateKeyJwk,
    sigAlg,
    privateKeyPkcs8Der,
  };
  return result;
}
