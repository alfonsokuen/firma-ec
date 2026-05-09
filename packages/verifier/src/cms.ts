import { ContentInfo, SignedData } from 'pkijs';
import type { SignerInfo, Certificate } from 'pkijs';
import { fromBER } from 'asn1js';
import { VerificationError, ERR_CMS_PARSE } from './errors';

export interface ParsedCms {
  /** The X.509 cert that signed the SignedData */
  signerCert: Certificate;
  /** Other certs included (intermediates between signer and root) */
  intermediates: Certificate[];
  /** OID of digest algorithm (used to hash the PDF bytes covered by /ByteRange) */
  digestAlgoOid: string;
  /** OID of the signature algorithm (rsaEncryption, ecdsa-with-SHA256, etc.) */
  signatureAlgoOid: string;
  /** The expected message digest from signed attrs — what the hash of /ByteRange must equal */
  signedMessageDigest: Uint8Array;
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
    asn = fromBER(contents.buffer.slice(contents.byteOffset, contents.byteOffset + contents.byteLength) as ArrayBuffer);
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

  // messageDigest signed attribute — OID 1.2.840.113549.1.9.4 — required
  const md = findSignedAttr(signerInfo, '1.2.840.113549.1.9.4');
  if (!md) {
    throw new VerificationError(ERR_CMS_PARSE, 'messageDigest signed attribute missing');
  }
  // values is any[] — index 0 is safe here; assert per noUncheckedIndexedAccess
  // pkijs typing limitation
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const signedMessageDigest = new Uint8Array(md.values[0]!.valueBlock.valueHex as ArrayBuffer);

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
  let timestampToken: Uint8Array | undefined;
  const tsAttrs = signerInfo.unsignedAttrs?.attributes ?? [];
  const tsAttr = tsAttrs.find((a) => a.type === '1.2.840.113549.1.9.16.2.14');
  if (tsAttr) {
    // pkijs typing limitation
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const tsBer = tsAttr.values[0]!.valueBlock.valueHex as ArrayBuffer;
    timestampToken = new Uint8Array(tsBer);
  }

  // Encode signedAttrs as DER (for signature verification later)
  const signedAttrsDer = signerInfo.signedAttrs
    ? new Uint8Array(signerInfo.signedAttrs.toSchema().toBER(false))
    : new Uint8Array(0);

  // signature is asn1js.OctetString — valueBlock.valueHexView is Uint8Array, valueHex is ArrayBuffer
  const signatureValue = new Uint8Array(signerInfo.signature.valueBlock.valueHex as ArrayBuffer);

  const result: ParsedCms = {
    signerCert,
    intermediates,
    digestAlgoOid: signerInfo.digestAlgorithm.algorithmId,
    signatureAlgoOid: signerInfo.signatureAlgorithm.algorithmId,
    signedMessageDigest,
    signedAttrsDer,
    signatureValue,
  };

  // Conditional spread for exactOptionalPropertyTypes
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
