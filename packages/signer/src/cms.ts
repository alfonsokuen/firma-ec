/**
 * CMS SignedData builder for PAdES-B-B (detached, ETSI.CAdES.detached subfilter).
 *
 * Inputs:
 *   - signer cert (with chain),
 *   - message digest of the PDF coveredBytes (already hashed by caller),
 *   - private key as a non-extractable WebCrypto CryptoKey,
 *   - SigAlg (drives digest + signature OIDs).
 *
 * Output: DER-encoded `ContentInfo { SignedData }` ready to embed in the
 * PDF /Contents hex octet string.
 *
 * Signed attributes included (PAdES-B-B minimum):
 *   - content-type     (1.2.840.113549.1.9.3)   value = id-data
 *   - message-digest   (1.2.840.113549.1.9.4)   value = hash of coveredBytes
 *   - signing-time     (1.2.840.113549.1.9.5)   value = signingTime
 *   - signing-certificate-v2 (1.2.840.113549.1.9.16.2.47) value = SHA-256 hash of cert
 *
 * The `eContentType` is `id-data` (1.2.840.113549.1.7.1) and the `eContent`
 * is omitted (detached form), which is required by ETSI.CAdES.detached.
 */

import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { SignerError } from './errors.js';
import { hashOf, signWithKey } from './webcrypto.js';
import type { SigAlg } from './types.js';

const OID_CONTENT_TYPE_ATTR = '1.2.840.113549.1.9.3';
const OID_MESSAGE_DIGEST_ATTR = '1.2.840.113549.1.9.4';
const OID_SIGNING_TIME_ATTR = '1.2.840.113549.1.9.5';
const OID_SIGNING_CERTIFICATE_V2 = '1.2.840.113549.1.9.16.2.47';
const OID_DATA = '1.2.840.113549.1.7.1';
const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';

/** Map hash → digest algorithm OID. */
const HASH_OID: Record<string, string> = {
  'SHA-256': '2.16.840.1.101.3.4.2.1',
  'SHA-384': '2.16.840.1.101.3.4.2.2',
  'SHA-512': '2.16.840.1.101.3.4.2.3',
};

/** Map SigAlg → signature algorithm OID (for SignerInfo.signatureAlgorithm). */
function signatureOid(sigAlg: SigAlg): string {
  if (sigAlg === 'RSA-PKCS1-SHA256') return '1.2.840.113549.1.1.11'; // sha256WithRSAEncryption
  if (sigAlg === 'RSA-PKCS1-SHA384') return '1.2.840.113549.1.1.12';
  if (sigAlg === 'RSA-PKCS1-SHA512') return '1.2.840.113549.1.1.13';
  if (sigAlg === 'RSA-PSS-SHA256' || sigAlg === 'RSA-PSS-SHA384' || sigAlg === 'RSA-PSS-SHA512')
    return '1.2.840.113549.1.1.10'; // id-RSASSA-PSS
  if (sigAlg === 'ECDSA-P256-SHA256') return '1.2.840.10045.4.3.2';
  if (sigAlg === 'ECDSA-P384-SHA384') return '1.2.840.10045.4.3.3';
  if (sigAlg === 'ECDSA-P521-SHA512') return '1.2.840.10045.4.3.4';
  throw new SignerError('cms_build_failed', `Unknown SigAlg ${sigAlg}`);
}

export interface BuildCmsOpts {
  /** Already-computed digest of the coveredBytes (length matches sigAlg's hash). */
  messageDigest: Uint8Array;
  /** Signing certificate (DER bytes). */
  signerCertDer: Uint8Array;
  /** Optional intermediate certs (DER bytes each). */
  intermediateCertDers?: Uint8Array[];
  /** Non-extractable private key. */
  privateKey: CryptoKey;
  /** Signature algorithm suite. */
  sigAlg: SigAlg;
  /** Signing time. */
  signingTime: Date;
}

/**
 * Build a detached CMS SignedData (PAdES-B-B) and return its DER bytes.
 *
 * The caller embeds the result directly in the PDF /Contents hex string.
 */
export async function buildCmsSignedData(opts: BuildCmsOpts): Promise<Uint8Array> {
  try {
    const hashAlg = hashOf(opts.sigAlg);
    const digestOid = HASH_OID[hashAlg];
    if (!digestOid) {
      throw new SignerError('cms_build_failed', `No OID for hash ${hashAlg}`);
    }
    const sigOid = signatureOid(opts.sigAlg);

    // Parse signer cert
    const signerCert = parseCert(opts.signerCertDer);
    const intermediates = (opts.intermediateCertDers ?? []).map(parseCert);

    // Compute SHA-256 of the signer cert DER (signing-certificate-v2 always uses SHA-256
    // unless the policy says otherwise; we follow RFC 5035 default).
    const certHash = new Uint8Array(await crypto.subtle.digest('SHA-256', toAb(opts.signerCertDer)));

    // Build signing-certificate-v2 ESSCertIDv2 SEQ:
    //   ESSCertIDv2 ::= SEQUENCE {
    //     hashAlgorithm AlgorithmIdentifier DEFAULT sha256,
    //     certHash      OCTET STRING,
    //     issuerSerial  IssuerSerial OPTIONAL
    //   }
    //   SigningCertificateV2 ::= SEQUENCE { certs SEQUENCE OF ESSCertIDv2 }
    const essCertIdV2 = new asn1js.Sequence({
      value: [
        // hashAlgorithm omitted (defaults to sha256)
        new asn1js.OctetString({ valueHex: toAb(certHash) }),
      ],
    });
    const signingCertV2 = new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [essCertIdV2] })] });

    // Build signedAttrs
    const signedAttrs: pkijs.Attribute[] = [
      new pkijs.Attribute({
        type: OID_CONTENT_TYPE_ATTR,
        values: [new asn1js.ObjectIdentifier({ value: OID_DATA })],
      }),
      new pkijs.Attribute({
        type: OID_SIGNING_TIME_ATTR,
        values: [new asn1js.UTCTime({ valueDate: opts.signingTime })],
      }),
      new pkijs.Attribute({
        type: OID_MESSAGE_DIGEST_ATTR,
        values: [new asn1js.OctetString({ valueHex: toAb(opts.messageDigest) })],
      }),
      new pkijs.Attribute({
        type: OID_SIGNING_CERTIFICATE_V2,
        values: [signingCertV2],
      }),
    ];

    // SignedAttributes DER for signing — uses IMPLICIT [0] tag in CMS but
    // when computing the signature we re-encode with universal SET tag (0x31)
    // per RFC 5652 §5.4.
    const signedAttrsSet = new pkijs.SignedAndUnsignedAttributes({
      type: 0,
      attributes: signedAttrs,
    });
    // P0 v0.4.4 fix: NEVER use `encodedValue` on a freshly-built
    // SignedAndUnsignedAttributes — that getter only returns bytes when the
    // object was *parsed* from BER. On the build path it's a 0-length
    // ArrayBuffer, which made us sign 0 bytes → produced a signature that
    // never matched what the verifier reconstructed from toSchema().toBER(),
    // → sigValid=false → status='invalid' on every round-trip. (User report
    // 2026-05-09: ArgosData .p12 signed PDFs returning "Firma inválida".)
    // Use toSchema().toBER(false) — same path the verifier uses — and patch
    // the IMPLICIT [0] (0xa0) tag to universal SET OF (0x31) per RFC 5652 §5.4.
    const signedAttrsBer = new Uint8Array(signedAttrsSet.toSchema().toBER(false));
    const signedAttrsDerForSign = new Uint8Array(signedAttrsBer);
    if (signedAttrsDerForSign.length > 0 && signedAttrsDerForSign[0] === 0xa0) {
      signedAttrsDerForSign[0] = 0x31;
    }

    // Sign the DER-encoded signedAttrs
    const signatureRaw = await signWithKey(opts.privateKey, signedAttrsDerForSign, opts.sigAlg);

    // Build SignerInfo
    const signerInfo = new pkijs.SignerInfo({
      version: 1,
      sid: new pkijs.IssuerAndSerialNumber({
        issuer: signerCert.issuer,
        serialNumber: signerCert.serialNumber,
      }),
      digestAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: digestOid }),
      signedAttrs: signedAttrsSet,
      signatureAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: sigOid }),
      signature: new asn1js.OctetString({ valueHex: signatureRaw }),
    });

    // Build SignedData
    const signedData = new pkijs.SignedData({
      version: 1,
      digestAlgorithms: [new pkijs.AlgorithmIdentifier({ algorithmId: digestOid })],
      encapContentInfo: new pkijs.EncapsulatedContentInfo({
        eContentType: OID_DATA,
        // eContent omitted → detached
      }),
      certificates: [signerCert, ...intermediates],
      signerInfos: [signerInfo],
    });

    // Wrap in ContentInfo
    const contentInfo = new pkijs.ContentInfo({
      contentType: OID_SIGNED_DATA,
      content: signedData.toSchema(true),
    });

    return new Uint8Array(contentInfo.toSchema().toBER(false));
  } catch (cause) {
    if (cause instanceof SignerError) throw cause;
    throw new SignerError(
      'cms_build_failed',
      `CMS SignedData build failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    );
  }
}

function parseCert(der: Uint8Array): pkijs.Certificate {
  const ab = toAb(der);
  const parsed = asn1js.fromBER(ab);
  if (parsed.offset === -1) {
    throw new SignerError('cms_build_failed', 'Failed to parse certificate DER');
  }
  return new pkijs.Certificate({ schema: parsed.result });
}

function toAb(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}
