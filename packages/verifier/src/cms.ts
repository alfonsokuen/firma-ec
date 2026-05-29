import { fromBER } from 'asn1js';
import { ContentInfo, SignedData } from 'pkijs';
import type { Certificate, SignerInfo } from 'pkijs';
import { ERR_CMS_PARSE, VerificationError } from './errors';

export interface ParsedCms {
  /** The X.509 cert that signed the SignedData */
  signerCert: Certificate;
  /** Other certs included (intermediates between signer and root) */
  intermediates: Certificate[];
  /** OID of digest algorithm (used to hash the PDF bytes covered by /ByteRange) */
  digestAlgoOid: string;
  /** OID of the signature algorithm (rsaEncryption, ecdsa-with-SHA256, etc.) */
  signatureAlgoOid: string;
  /**
   * Whether the CMS carries CMS signed attributes (PAdES-B-B). When false, this
   * is a bare CAdES-BES profile where the signature is computed directly over
   * the eContent (the /ByteRange-covered bytes) and there is no message-digest
   * attribute — seen with some Ecuadorian ECIs (Security Data, BCE).
   */
  hasSignedAttrs: boolean;
  /**
   * The expected message digest from signed attrs — what the hash of /ByteRange
   * must equal. Undefined when {@link hasSignedAttrs} is false.
   */
  signedMessageDigest?: Uint8Array | undefined;
  /**
   * Encapsulated eContent, if present. For the legacy Adobe `adbe.pkcs7.sha1`
   * subfilter this carries the SHA-1 digest of the /ByteRange-covered bytes
   * (the document hash), and the signature is computed over THIS value (or over
   * signed attrs whose message-digest equals hash(eContent)).
   */
  eContent?: Uint8Array | undefined;
  /** Signing time from signedAttrs, if present */
  signingTime?: Date | undefined;
  /** Embedded TSA token (PAdES B-T+), if present */
  timestampToken?: Uint8Array | undefined;
  /** Reason / location lifted from PDF dict but expose here too if available */
  reason?: string | undefined;
  /** The DER-encoded signedAttributes bytes (for signature verification) */
  signedAttrsDer: Uint8Array;
  /** The signature value (RSA or ECDSA) */
  signatureValue: Uint8Array;
}

function bufToHex(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += u8[i]!.toString(16).padStart(2, '0');
  return s;
}

// pkijs typing limitation
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findSignedAttr(signerInfo: SignerInfo, oid: string): any {
  // signedAttrs is optional on SignerInfo; attributes is required on SignedAndUnsignedAttributes
  const attrs = signerInfo.signedAttrs?.attributes ?? [];
  return attrs.find((a) => a.type === oid);
}

export async function parseCms(contents: Uint8Array): Promise<ParsedCms> {
  let asn;
  try {
    asn = fromBER(
      contents.buffer.slice(
        contents.byteOffset,
        contents.byteOffset + contents.byteLength,
      ) as ArrayBuffer,
    );
  } catch (e) {
    throw new VerificationError(ERR_CMS_PARSE, `ASN.1 decode failed: ${(e as Error).message}`);
  }
  if (asn.offset === -1) {
    throw new VerificationError(ERR_CMS_PARSE, 'ASN.1 BER decode returned -1 offset');
  }

  let cmsContentInfo: ContentInfo;
  try {
    cmsContentInfo = new ContentInfo({ schema: asn.result });
  } catch (e) {
    throw new VerificationError(ERR_CMS_PARSE, `ContentInfo parse failed: ${(e as Error).message}`);
  }

  if (cmsContentInfo.contentType !== '1.2.840.113549.1.7.2') {
    throw new VerificationError(
      ERR_CMS_PARSE,
      `Unexpected ContentInfo OID: ${cmsContentInfo.contentType} (expected SignedData 1.2.840.113549.1.7.2)`,
    );
  }

  let signedData: SignedData;
  try {
    signedData = new SignedData({ schema: cmsContentInfo.content });
  } catch (e) {
    throw new VerificationError(ERR_CMS_PARSE, `SignedData parse failed: ${(e as Error).message}`);
  }

  if (signedData.signerInfos.length === 0) {
    throw new VerificationError(ERR_CMS_PARSE, 'SignedData has zero SignerInfos');
  }

  // Pick the first signer (PAdES B-B has exactly one)
  const signerInfo = signedData.signerInfos[0]!;

  // SignedData.certificates is CertificateSetItem[] — cast to Certificate[] for PAdES (pkijs typing limitation)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allCerts = (signedData.certificates ?? []) as any as Certificate[];
  const signerCert = findSignerCert(allCerts, signerInfo);
  if (!signerCert) {
    throw new VerificationError(ERR_CMS_PARSE, 'Signer cert not found in SignedData.certificates');
  }
  const intermediates = allCerts.filter((c) => c !== signerCert);

  // CMS signed attributes are present in PAdES-B-B but ABSENT in the bare
  // CAdES-BES profile some Ecuadorian ECIs (Security Data, BCE) emit, where the
  // signature is computed directly over the eContent (/ByteRange bytes). Detect
  // this and let the verifier take the no-signedAttrs path instead of failing.
  const hasSignedAttrs = (signerInfo.signedAttrs?.attributes?.length ?? 0) > 0;

  // messageDigest signed attribute — OID 1.2.840.113549.1.9.4 — required ONLY
  // when signed attributes are present.
  let signedMessageDigest: Uint8Array | undefined;
  if (hasSignedAttrs) {
    const md = findSignedAttr(signerInfo, '1.2.840.113549.1.9.4');
    if (!md) {
      throw new VerificationError(ERR_CMS_PARSE, 'messageDigest signed attribute missing');
    }
    // values is any[] — index 0 is safe here; assert per noUncheckedIndexedAccess
    // pkijs typing limitation
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    signedMessageDigest = new Uint8Array(md.values[0]!.valueBlock.valueHex as ArrayBuffer);
  }

  // signingTime — OID 1.2.840.113549.1.9.5 — optional
  const stAttr = findSignedAttr(signerInfo, '1.2.840.113549.1.9.5');
  let signingTime: Date | undefined;
  if (stAttr) {
    // pkijs typing limitation
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const v = stAttr.values[0] as { toDate?: () => Date; valueBlock?: { value: string } };
    signingTime = v.toDate?.() ?? (v.valueBlock ? new Date(v.valueBlock.value) : undefined);
  }

  // Unsigned attribute: timestampToken — OID 1.2.840.113549.1.9.16.2.14
  // The attr value is a ContentInfo (TimeStampToken), a complex SEQUENCE.
  // valueBlock.valueHex is EMPTY for parsed Sequences in asn1js — same trap as
  // F3 v0.4.4 (pkijs encodedValue empty on build path). Prefer the original
  // parsed bytes (valueBeforeDecodeView), fallback to re-encoding via toBER.
  let timestampToken: Uint8Array | undefined;
  const tsAttrs = signerInfo.unsignedAttrs?.attributes ?? [];
  const tsAttr = tsAttrs.find((a) => a.type === '1.2.840.113549.1.9.16.2.14');
  if (tsAttr) {
    // pkijs typing limitation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ts = tsAttr.values[0] as any;
    // asn1js stores original bytes when parsed from BER
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const rawView = ts?.valueBeforeDecodeView as Uint8Array | undefined;
    let tsBytes: Uint8Array;
    if (rawView && rawView.byteLength > 0) {
      // Copy out of the underlying buffer (which may be the entire CMS).
      tsBytes = new Uint8Array(rawView.byteLength);
      tsBytes.set(rawView);
    } else {
      // Fallback: re-encode the value via toBER (same trick as signedAttrsDer).
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const ber = ts.toBER(false) as ArrayBuffer;
      tsBytes = new Uint8Array(ber);
    }
    if (tsBytes.byteLength > 0) timestampToken = tsBytes;
  }

  // Encode signedAttrs as DER (for signature verification later).
  // RFC 5652 §5.4: when computing the signature, signedAttrs MUST be re-encoded
  // with EXPLICIT SET OF tag (0x31), not the IMPLICIT [0] tag (0xa0) that
  // appears on the wire inside SignerInfo. pkijs's toBER() emits the IMPLICIT
  // form (0xa0) by default, so we patch the first byte. Length encoding stays
  // identical because tag class change doesn't affect the length octets.
  let signedAttrsDer: Uint8Array;
  if (signerInfo.signedAttrs) {
    const der = new Uint8Array(signerInfo.signedAttrs.toSchema().toBER(false));
    signedAttrsDer = new Uint8Array(der);
    if (signedAttrsDer.length > 0 && signedAttrsDer[0] === 0xa0) {
      signedAttrsDer[0] = 0x31;
    }
  } else {
    signedAttrsDer = new Uint8Array(0);
  }

  // Encapsulated eContent (present for adbe.pkcs7.sha1 — carries SHA-1 of the
  // byte range). pkijs exposes it as an OctetString on encapContentInfo.eContent.
  let eContent: Uint8Array | undefined;
  // pkijs typing limitation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const ec = (signedData.encapContentInfo as any)?.eContent;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const ecView = ec?.valueBlock?.valueHexView as Uint8Array | undefined;
  if (ecView && ecView.byteLength > 0) {
    eContent = new Uint8Array(ecView.byteLength);
    eContent.set(ecView);
  }

  // signature is asn1js.OctetString — valueBlock.valueHexView is Uint8Array, valueHex is ArrayBuffer
  const signatureValue = new Uint8Array(signerInfo.signature.valueBlock.valueHex as ArrayBuffer);

  const result: ParsedCms = {
    signerCert,
    intermediates,
    digestAlgoOid: signerInfo.digestAlgorithm.algorithmId,
    signatureAlgoOid: signerInfo.signatureAlgorithm.algorithmId,
    hasSignedAttrs,
    signedAttrsDer,
    signatureValue,
  };

  // Conditional spread for exactOptionalPropertyTypes
  if (signedMessageDigest !== undefined) result.signedMessageDigest = signedMessageDigest;
  if (eContent !== undefined) result.eContent = eContent;
  if (signingTime !== undefined) result.signingTime = signingTime;
  if (timestampToken !== undefined) result.timestampToken = timestampToken;

  return result;
}

function findSignerCert(certs: Certificate[], signerInfo: SignerInfo): Certificate | undefined {
  // sid is SchemaType (typed loosely in pkijs) — cast for IssuerAndSerialNumber or SKI access
  // pkijs typing limitation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sid = signerInfo.sid as any;

  // IssuerAndSerialNumber
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (sid.issuer && sid.serialNumber) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const wantSerialHex = bufToHex(sid.serialNumber.valueBlock.valueHex as ArrayBuffer);
    return certs.find((c) => {
      const haveSerial = bufToHex(c.serialNumber.valueBlock.valueHex as ArrayBuffer);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      return haveSerial === wantSerialHex && c.issuer.isEqual(sid.issuer);
    });
  }

  // SubjectKeyIdentifier — match against cert's SKI extension
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (sid.valueBlock?.valueHex) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const wantSki = bufToHex(sid.valueBlock.valueHex as ArrayBuffer);
    return certs.find((c) => {
      const skiExt = c.extensions?.find((e) => e.extnID === '2.5.29.14');
      if (!skiExt) return false;
      // pkijs typing limitation
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      return bufToHex((skiExt.parsedValue as any).valueBlock.valueHex as ArrayBuffer) === wantSki;
    });
  }

  return undefined;
}
