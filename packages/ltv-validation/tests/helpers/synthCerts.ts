/**
 * Test helpers — synthesize a mini PKI (CA + leaf), an OCSP request matcher,
 * and a signed BasicOCSPResponse + CertificateList using node-forge so tests
 * don't depend on network or external fixtures.
 */

import * as asn1js from 'asn1js';
import forge from 'node-forge';
import * as pkijs from 'pkijs';
import type { ParsedCert } from '../../src/types';

export interface SynthPair {
  caCertPem: string;
  caKeyPem: string;
  leafCertPem: string;
  leafKeyPem: string;
  caCert: forge.pki.Certificate;
  leafCert: forge.pki.Certificate;
  caKey: forge.pki.rsa.PrivateKey;
  leafKey: forge.pki.rsa.PrivateKey;
}

function makeKeyPair(): forge.pki.rsa.KeyPair {
  return forge.pki.rsa.generateKeyPair({ bits: 2048 });
}

/**
 * Build the OCTET STRING contents value of an AIA extension (RFC 5280) with a
 * single access description: { accessMethod = id-ad-ocsp, accessLocation = URI }.
 *
 * Returned as a binary string (forge convention for raw extension `value`).
 */
function buildAiaExtnValueDer(ocspUrl: string): string {
  // AuthorityInfoAccessSyntax ::= SEQUENCE OF AccessDescription
  // AccessDescription ::= SEQUENCE { accessMethod OID, accessLocation GeneralName }
  // GeneralName uniformResourceIdentifier [6] IA5String — IMPLICIT.
  const uriBytes = new Uint8Array(ocspUrl.length);
  for (let i = 0; i < ocspUrl.length; i++) uriBytes[i] = ocspUrl.charCodeAt(i) & 0xff;
  const accessLocation = new asn1js.Constructed({
    idBlock: { tagClass: 3, tagNumber: 6 } as never, // [6] context-specific
    value: [],
  });
  // For an IA5String wrapped in an IMPLICIT [6], we set valueHex on a Primitive instead.
  const accessLocationPrim = new asn1js.Primitive({
    idBlock: { tagClass: 3, tagNumber: 6 } as never,
    valueHex: uriBytes.buffer.slice(
      uriBytes.byteOffset,
      uriBytes.byteOffset + uriBytes.byteLength,
    ) as ArrayBuffer,
  });
  void accessLocation;

  const accessDescription = new asn1js.Sequence({
    value: [
      new asn1js.ObjectIdentifier({ value: '1.3.6.1.5.5.7.48.1' }), // id-ad-ocsp
      accessLocationPrim,
    ],
  });
  const aia = new asn1js.Sequence({ value: [accessDescription] });
  const der = new Uint8Array(aia.toBER(false));
  return uint8ToBin(der);
}

/**
 * Build CRL Distribution Points (RFC 5280) extnValue with a single
 * DistributionPoint whose `distributionPoint` is fullName containing one URI.
 */
function buildCdpExtnValueDer(crlUrl: string): string {
  // CRLDistributionPoints ::= SEQUENCE OF DistributionPoint
  // DistributionPoint ::= SEQUENCE { distributionPoint [0] DistributionPointName OPTIONAL, ... }
  // DistributionPointName ::= CHOICE { fullName [0] GeneralNames, ... }
  // GeneralNames ::= SEQUENCE OF GeneralName
  // GeneralName uniformResourceIdentifier [6] IA5String IMPLICIT.
  const uriBytes = new Uint8Array(crlUrl.length);
  for (let i = 0; i < crlUrl.length; i++) uriBytes[i] = crlUrl.charCodeAt(i) & 0xff;
  const uriGn = new asn1js.Primitive({
    idBlock: { tagClass: 3, tagNumber: 6 } as never,
    valueHex: uriBytes.buffer.slice(
      uriBytes.byteOffset,
      uriBytes.byteOffset + uriBytes.byteLength,
    ) as ArrayBuffer,
  });
  const fullNameGNs = new asn1js.Constructed({
    idBlock: { tagClass: 3, tagNumber: 0 } as never, // [0] fullName
    value: [uriGn],
  });
  const distributionPointName = new asn1js.Constructed({
    idBlock: { tagClass: 3, tagNumber: 0 } as never, // [0] distributionPoint
    value: [fullNameGNs],
  });
  const distributionPoint = new asn1js.Sequence({ value: [distributionPointName] });
  const cdp = new asn1js.Sequence({ value: [distributionPoint] });
  const der = new Uint8Array(cdp.toBER(false));
  return uint8ToBin(der);
}

export function makeSynthPair(opts?: { withAia?: string; withCdp?: string }): SynthPair {
  const caKeys = makeKeyPair();
  const leafKeys = makeKeyPair();

  const now = new Date();
  const caCert = forge.pki.createCertificate();
  caCert.publicKey = caKeys.publicKey;
  caCert.serialNumber = '01';
  caCert.validity.notBefore = new Date(now.getTime() - 86400000);
  caCert.validity.notAfter = new Date(now.getTime() + 365 * 86400000);
  const caAttrs = [
    { name: 'commonName', value: 'TEST-CA' },
    { name: 'countryName', value: 'EC' },
  ];
  caCert.setSubject(caAttrs);
  caCert.setIssuer(caAttrs);
  caCert.setExtensions([
    { name: 'basicConstraints', cA: true } as forge.pki.CertificateExtension,
    {
      name: 'keyUsage',
      keyCertSign: true,
      cRLSign: true,
      digitalSignature: true,
    } as forge.pki.CertificateExtension,
    { name: 'subjectKeyIdentifier' } as forge.pki.CertificateExtension,
  ]);
  caCert.sign(caKeys.privateKey, forge.md.sha256.create());

  const leafCert = forge.pki.createCertificate();
  leafCert.publicKey = leafKeys.publicKey;
  leafCert.serialNumber = '02ab';
  leafCert.validity.notBefore = new Date(now.getTime() - 86400000);
  leafCert.validity.notAfter = new Date(now.getTime() + 180 * 86400000);
  leafCert.setSubject([
    { name: 'commonName', value: 'TEST-LEAF' },
    { name: 'countryName', value: 'EC' },
  ]);
  leafCert.setIssuer(caAttrs);
  const leafExts: forge.pki.CertificateExtension[] = [
    { name: 'basicConstraints', cA: false } as forge.pki.CertificateExtension,
    {
      name: 'keyUsage',
      digitalSignature: true,
      nonRepudiation: true,
    } as forge.pki.CertificateExtension,
    { name: 'subjectKeyIdentifier' } as forge.pki.CertificateExtension,
  ];
  if (opts?.withAia) {
    // Forge has no first-class AIA helper. Build the extnValue OCTET STRING
    // payload as raw DER and inject via { id, value } shape.
    leafExts.push({
      id: '1.3.6.1.5.5.7.1.1',
      critical: false,
      value: buildAiaExtnValueDer(opts.withAia),
    } as unknown as forge.pki.CertificateExtension);
  }
  if (opts?.withCdp) {
    leafExts.push({
      id: '2.5.29.31',
      critical: false,
      value: buildCdpExtnValueDer(opts.withCdp),
    } as unknown as forge.pki.CertificateExtension);
  }
  leafCert.setExtensions(leafExts);
  leafCert.sign(caKeys.privateKey, forge.md.sha256.create());

  return {
    caCertPem: forge.pki.certificateToPem(caCert),
    caKeyPem: forge.pki.privateKeyToPem(caKeys.privateKey),
    leafCertPem: forge.pki.certificateToPem(leafCert),
    leafKeyPem: forge.pki.privateKeyToPem(leafKeys.privateKey),
    caCert,
    leafCert,
    caKey: caKeys.privateKey,
    leafKey: leafKeys.privateKey,
  };
}

/** Convert a forge cert to a ParsedCert (subset shape used by ltv-validation). */
export function forgeToParsedCert(cert: forge.pki.Certificate): ParsedCert {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const u = new Uint8Array(der.length);
  for (let i = 0; i < der.length; i++) u[i] = der.charCodeAt(i) & 0xff;
  const cn = (cert.subject.getField('CN') as { value?: string } | null)?.value ?? null;
  const issuerCn = (cert.issuer.getField('CN') as { value?: string } | null)?.value ?? null;
  return {
    subjectCN: cn,
    issuerCN: issuerCn,
    der: u,
    notBefore: cert.validity.notBefore,
    notAfter: cert.validity.notAfter,
  };
}

function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function pkijsCertFromForge(cert: forge.pki.Certificate): pkijs.Certificate {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const buf = binToUint8(der);
  const asn = asn1js.fromBER(toArrayBuffer(buf));
  if (asn.offset === -1) throw new Error('cert decode failed');
  return new pkijs.Certificate({ schema: asn.result });
}

/**
 * Build a real, CA-signed OCSPResponse (BasicOCSPResponse inside) that echoes
 * the CertID of `requestDer` — i.e. exactly what a responder does.
 *
 * Signed with forge (RSA PKCS#1 v1.5 / SHA-256) over the DER of tbsResponseData
 * so no WebCrypto private-key import is needed, mirroring
 * {@link makeSyntheticCrlDer}. The CA cert is attached in `certs` (responder =
 * issuer), which is what `parseOcspResponse` → `BasicOCSPResponse.verify`
 * needs to find the signer and chain it to the trusted issuer.
 *
 * `thisUpdate`/`nextUpdate` are caller-controlled so tests can produce an
 * ALREADY-EXPIRED response (the freshness-vs-TTL corpus).
 */
export function makeSignedOcspResponseDer(opts: {
  requestDer: Uint8Array;
  caCert: forge.pki.Certificate;
  caKey: forge.pki.rsa.PrivateKey;
  thisUpdate: Date;
  nextUpdate?: Date;
  producedAt?: Date;
  /** 'good' (default) or 'revoked'. */
  status?: 'good' | 'revoked';
}): Uint8Array {
  const caPki = pkijsCertFromForge(opts.caCert);

  // Echo the request's CertID verbatim.
  const reqAsn = asn1js.fromBER(toArrayBuffer(opts.requestDer));
  if (reqAsn.offset === -1) throw new Error('OCSPRequest decode failed');
  const ocspReq = new pkijs.OCSPRequest({ schema: reqAsn.result });
  const reqCert = ocspReq.tbsRequest.requestList?.[0]?.reqCert;
  if (!reqCert) throw new Error('OCSPRequest has no reqCert');

  const certStatus =
    (opts.status ?? 'good') === 'revoked'
      ? new asn1js.Constructed({
          idBlock: { tagClass: 3, tagNumber: 1 } as never,
          value: [new asn1js.GeneralizedTime({ valueDate: opts.thisUpdate })],
        })
      : new asn1js.Primitive({
          idBlock: { tagClass: 3, tagNumber: 0 } as never,
          lenBlock: { length: 0 } as never,
        });

  const single = new pkijs.SingleResponse({
    certID: reqCert,
    thisUpdate: opts.thisUpdate,
    ...(opts.nextUpdate ? { nextUpdate: opts.nextUpdate } : {}),
  } as never);
  single.certStatus = certStatus;

  const responseData = new pkijs.ResponseData();
  responseData.responderID = caPki.subject;
  responseData.producedAt = opts.producedAt ?? opts.thisUpdate;
  responseData.responses = [single];

  const tbsSchema = responseData.toSchema(true);
  const tbsDer = new Uint8Array(tbsSchema.toBER(false));

  const sigAlg = new pkijs.AlgorithmIdentifier({ algorithmId: '1.2.840.113549.1.1.11' });
  const md = forge.md.sha256.create();
  md.update(uint8ToBin(tbsDer), 'raw');
  const sigBytes = binToUint8(opts.caKey.sign(md));

  const basic = new asn1js.Sequence({
    value: [
      tbsSchema,
      sigAlg.toSchema(),
      new asn1js.BitString({ valueHex: toArrayBuffer(sigBytes) }),
      new asn1js.Constructed({
        idBlock: { tagClass: 3, tagNumber: 0 } as never,
        value: [new asn1js.Sequence({ value: [caPki.toSchema()] })],
      }),
    ],
  });
  const basicDer = new Uint8Array(basic.toBER(false));

  const ocspResponse = new asn1js.Sequence({
    value: [
      new asn1js.Enumerated({ value: 0 }), // successful
      new asn1js.Constructed({
        idBlock: { tagClass: 3, tagNumber: 0 } as never,
        value: [
          new asn1js.Sequence({
            value: [
              new asn1js.ObjectIdentifier({ value: '1.3.6.1.5.5.7.48.1.1' }), // id-pkix-ocsp-basic
              new asn1js.OctetString({ valueHex: toArrayBuffer(basicDer) }),
            ],
          }),
        ],
      }),
    ],
  });

  return new Uint8Array(ocspResponse.toBER(false));
}

/**
 * Build a leaf signed by `pair`'s CA with a caller-chosen serial (hex, no
 * `0x` prefix) — lets adversarial/regression fixtures force a specific DER
 * shape. node-forge writes the hex bytes verbatim as the INTEGER content
 * (it does NOT auto-add the RFC 5280 §4.1.2.2 / ITU-T X.690 §8.3.2 leading
 * `0x00` pad a non-negative INTEGER needs when its first byte's high bit is
 * set) — callers that want a padded serial must include the `00` themselves,
 * e.g. `'0080ab'` rather than `'80ab'`.
 */
export function makeLeafWithSerial(
  pair: SynthPair,
  serialHex: string,
  cn: string,
): forge.pki.Certificate {
  const keys = makeKeyPair();
  const now = new Date();
  const leaf = forge.pki.createCertificate();
  leaf.publicKey = keys.publicKey;
  leaf.serialNumber = serialHex;
  leaf.validity.notBefore = new Date(now.getTime() - 86400000);
  leaf.validity.notAfter = new Date(now.getTime() + 180 * 86400000);
  leaf.setSubject([{ name: 'commonName', value: cn }]);
  leaf.setIssuer(pair.caCert.subject.attributes);
  leaf.setExtensions([{ name: 'basicConstraints', cA: false } as forge.pki.CertificateExtension]);
  leaf.sign(pair.caKey, forge.md.sha256.create());
  return leaf;
}

/**
 * Build a delegate OCSP-responder cert, signed by the CA, distinct from both
 * the CA and the leaf. `withOcspEku` controls whether it carries the
 * id-kp-OCSPSigning EKU (1.3.6.1.5.5.7.3.9) RFC 6960 §4.2.2.2 requires on a
 * delegate — omit it to build the P4 (missing-EKU) adversarial fixture.
 */
export function makeDelegateCert(
  pair: SynthPair,
  opts?: { withOcspEku?: boolean },
): { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey } {
  const keys = makeKeyPair();
  const now = new Date();
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '03cd';
  cert.validity.notBefore = new Date(now.getTime() - 86400000);
  cert.validity.notAfter = new Date(now.getTime() + 180 * 86400000);
  cert.setSubject([
    { name: 'commonName', value: 'TEST-OCSP-DELEGATE' },
    { name: 'countryName', value: 'EC' },
  ]);
  cert.setIssuer(pair.caCert.subject.attributes);
  const exts: forge.pki.CertificateExtension[] = [
    { name: 'basicConstraints', cA: false } as forge.pki.CertificateExtension,
    { name: 'keyUsage', digitalSignature: true } as forge.pki.CertificateExtension,
  ];
  const ekuExt: Record<string, unknown> = { name: 'extKeyUsage' };
  if (opts?.withOcspEku) ekuExt['1.3.6.1.5.5.7.3.9'] = true;
  else ekuExt['1.3.6.1.5.5.7.3.1'] = true; // id-kp-serverAuth — present but NOT OCSPSigning
  exts.push(ekuExt as unknown as forge.pki.CertificateExtension);
  cert.setExtensions(exts);
  cert.sign(pair.caKey, forge.md.sha256.create());
  return { cert, key: keys.privateKey };
}

export interface OcspResponseEntrySpec {
  /** A built OCSPRequest DER (from `buildOcspRequest`) — its `reqCert` (CertID) is echoed verbatim, exactly as a real responder would, including any deliberate mismatch (adversarial fixtures pass a request built against a DIFFERENT leaf/issuer than the one under test). */
  requestDer: Uint8Array;
  thisUpdate: Date;
  nextUpdate?: Date;
  status?: 'good' | 'revoked';
  /** When set, rebuild the CertID's serialNumber from this hex instead of
   * echoing the request's verbatim — simulates a responder that
   * re-DER-encodes the serial (e.g. strips a redundant 0x00 pad) rather
   * than copying the request byte-for-byte. Everything else in the CertID
   * (hashAlgorithm, issuerNameHash, issuerKeyHash) still comes from the
   * request. */
  serialOverrideHex?: string;
}

function hexToBytesLocal(hex: string): Uint8Array {
  const padded = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(padded.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(padded.substr(i * 2, 2), 16);
  return out;
}

/**
 * General-purpose signed BasicOCSPResponse builder — multiple SingleResponse
 * entries, an arbitrary signer (issuer-direct or delegate), and control over
 * which certs (if any) get attached, for the adversarial (P1-P7) corpus.
 */
export function makeMultiSignedOcspResponseDer(opts: {
  entries: OcspResponseEntrySpec[];
  signerCert: forge.pki.Certificate;
  signerKey: forge.pki.rsa.PrivateKey;
  /** Cert whose subject drives responderID (byName). Defaults to signerCert. */
  responderIdCert?: forge.pki.Certificate;
  /** Certs to attach as certs[]. Defaults to [signerCert]. Pass [] to omit the field entirely (the ArgosData shape). */
  attachCerts?: forge.pki.Certificate[];
  producedAt?: Date;
  /** Raw nonce bytes; wrapped as the RFC 6960 §4.4.1 double OCTET STRING automatically. */
  nonceBytes?: Uint8Array;
}): Uint8Array {
  const responderIdCert = opts.responderIdCert ?? opts.signerCert;
  const responderIdPki = pkijsCertFromForge(responderIdCert);
  const attachCerts = opts.attachCerts ?? [opts.signerCert];

  const singles = opts.entries.map((entry) => {
    const reqAsn = asn1js.fromBER(toArrayBuffer(entry.requestDer));
    if (reqAsn.offset === -1) throw new Error('OCSPRequest decode failed');
    const ocspReq = new pkijs.OCSPRequest({ schema: reqAsn.result });
    const echoedCert = ocspReq.tbsRequest.requestList?.[0]?.reqCert;
    if (!echoedCert) throw new Error('OCSPRequest has no reqCert');
    const reqCert =
      entry.serialOverrideHex !== undefined
        ? new pkijs.CertID({
            hashAlgorithm: echoedCert.hashAlgorithm,
            issuerNameHash: echoedCert.issuerNameHash,
            issuerKeyHash: echoedCert.issuerKeyHash,
            serialNumber: new asn1js.Integer({
              valueHex: toArrayBuffer(hexToBytesLocal(entry.serialOverrideHex)),
            }),
          })
        : echoedCert;

    const certStatus =
      (entry.status ?? 'good') === 'revoked'
        ? new asn1js.Constructed({
            idBlock: { tagClass: 3, tagNumber: 1 } as never,
            value: [new asn1js.GeneralizedTime({ valueDate: entry.thisUpdate })],
          })
        : new asn1js.Primitive({
            idBlock: { tagClass: 3, tagNumber: 0 } as never,
            lenBlock: { length: 0 } as never,
          });

    const single = new pkijs.SingleResponse({
      certID: reqCert,
      thisUpdate: entry.thisUpdate,
      ...(entry.nextUpdate ? { nextUpdate: entry.nextUpdate } : {}),
    } as never);
    single.certStatus = certStatus;
    return single;
  });

  const responseData = new pkijs.ResponseData();
  responseData.responderID = responderIdPki.subject;
  responseData.producedAt = opts.producedAt ?? opts.entries[0]?.thisUpdate ?? new Date();
  responseData.responses = singles;
  if (opts.nonceBytes) {
    const innerOctet = new asn1js.OctetString({ valueHex: toArrayBuffer(opts.nonceBytes) });
    responseData.responseExtensions = [
      new pkijs.Extension({
        extnID: '1.3.6.1.5.5.7.48.1.2',
        critical: false,
        extnValue: innerOctet.toBER(false),
      }),
    ];
  }

  const tbsSchema = responseData.toSchema(true);
  const tbsDer = new Uint8Array(tbsSchema.toBER(false));

  const sigAlg = new pkijs.AlgorithmIdentifier({ algorithmId: '1.2.840.113549.1.1.11' });
  const md = forge.md.sha256.create();
  md.update(uint8ToBin(tbsDer), 'raw');
  const sigBytes = binToUint8(opts.signerKey.sign(md));

  const basicValues: asn1js.AsnType[] = [
    tbsSchema,
    sigAlg.toSchema(),
    new asn1js.BitString({ valueHex: toArrayBuffer(sigBytes) }),
  ];
  if (attachCerts.length > 0) {
    basicValues.push(
      new asn1js.Constructed({
        idBlock: { tagClass: 3, tagNumber: 0 } as never,
        value: [
          new asn1js.Sequence({
            value: attachCerts.map((c) => pkijsCertFromForge(c).toSchema()),
          }),
        ],
      }),
    );
  }
  const basicDer = new Uint8Array(new asn1js.Sequence({ value: basicValues }).toBER(false));

  const ocspResponse = new asn1js.Sequence({
    value: [
      new asn1js.Enumerated({ value: 0 }), // successful
      new asn1js.Constructed({
        idBlock: { tagClass: 3, tagNumber: 0 } as never,
        value: [
          new asn1js.Sequence({
            value: [
              new asn1js.ObjectIdentifier({ value: '1.3.6.1.5.5.7.48.1.1' }), // id-pkix-ocsp-basic
              new asn1js.OctetString({ valueHex: toArrayBuffer(basicDer) }),
            ],
          }),
        ],
      }),
    ],
  });

  return new Uint8Array(ocspResponse.toBER(false));
}

/** Build a CRL signed by `caCert` listing the given serials as revoked. */
export function makeSyntheticCrlDer(opts: {
  caCert: forge.pki.Certificate;
  caKey: forge.pki.rsa.PrivateKey;
  revokedSerialsHex: string[];
}): Uint8Array {
  // node-forge has no first-class CRL builder; construct via low-level ASN.1.
  // We use pkijs to create + sign the CRL deterministically.
  const caDer = forge.asn1.toDer(forge.pki.certificateToAsn1(opts.caCert)).getBytes();
  const caBuf = new Uint8Array(caDer.length);
  for (let i = 0; i < caDer.length; i++) caBuf[i] = caDer.charCodeAt(i) & 0xff;
  const caAsn = asn1js.fromBER(
    caBuf.buffer.slice(caBuf.byteOffset, caBuf.byteOffset + caBuf.byteLength) as ArrayBuffer,
  );
  if (caAsn.offset === -1) throw new Error('CA decode failed');
  const caPki = new pkijs.Certificate({ schema: caAsn.result });

  // Derive a pkijs RSA private key from forge — easier: re-sign via forge's PKCS#1 v1.5.
  // pkijs CRL.sign needs a CryptoKey; cleanest path is to import the key into WebCrypto.
  // For simplicity, we construct the CRL with forge directly.

  const crl = forge.pki.createCertificate(); // placeholder — forge has no CRL helper
  void crl;

  // Manual ASN.1 path — build a CertificateList per RFC 5280 §5.1 using asn1js.
  // tbsCertList ::= SEQUENCE {
  //   version                 Version OPTIONAL, -- v2 = INTEGER 1
  //   signature               AlgorithmIdentifier,
  //   issuer                  Name,
  //   thisUpdate              Time,
  //   nextUpdate              Time OPTIONAL,
  //   revokedCertificates     SEQUENCE OF SEQUENCE { userCertificate, revocationDate, ... } OPTIONAL,
  //   crlExtensions           [0] EXPLICIT Extensions OPTIONAL
  // }

  const issuerAsn = caPki.issuer.toSchema();
  const sigAlgOid = '1.2.840.113549.1.1.11'; // sha256WithRSAEncryption
  const sigAlg = new pkijs.AlgorithmIdentifier({ algorithmId: sigAlgOid });

  const now = new Date();
  const next = new Date(now.getTime() + 7 * 86400000);

  const revoked = opts.revokedSerialsHex.map((hex) => {
    // userCertificate INTEGER + revocationDate UTCTime
    const serialBytes = hexToBytes(hex);
    return new asn1js.Sequence({
      value: [
        new asn1js.Integer({
          valueHex: serialBytes.buffer.slice(
            serialBytes.byteOffset,
            serialBytes.byteOffset + serialBytes.byteLength,
          ) as ArrayBuffer,
        }),
        new asn1js.UTCTime({ valueDate: now }),
      ],
    });
  });

  const tbsValues: asn1js.AsnType[] = [
    new asn1js.Integer({ value: 1 }), // v2
    sigAlg.toSchema(),
    issuerAsn,
    new asn1js.UTCTime({ valueDate: now }),
    new asn1js.UTCTime({ valueDate: next }),
  ];
  if (revoked.length > 0) {
    tbsValues.push(new asn1js.Sequence({ value: revoked }));
  }
  const tbs = new asn1js.Sequence({ value: tbsValues });
  const tbsDer = new Uint8Array(tbs.toBER(false));

  // Sign tbsDer with forge (RSA PKCS#1 v1.5 SHA-256).
  const md = forge.md.sha256.create();
  const tbsBin = uint8ToBin(tbsDer);
  md.update(tbsBin, 'raw');
  const sig = opts.caKey.sign(md);
  const sigBytes = binToUint8(sig);

  // CertificateList SEQUENCE { tbsCertList, signatureAlgorithm, signatureValue BIT STRING }
  const crlSchema = new asn1js.Sequence({
    value: [
      tbs,
      sigAlg.toSchema(),
      new asn1js.BitString({
        valueHex: sigBytes.buffer.slice(
          sigBytes.byteOffset,
          sigBytes.byteOffset + sigBytes.byteLength,
        ) as ArrayBuffer,
      }),
    ],
  });

  return new Uint8Array(crlSchema.toBER(false));
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const padded = clean.length % 2 === 0 ? clean : '0' + clean;
  const out = new Uint8Array(padded.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(padded.substr(i * 2, 2), 16);
  }
  return out;
}

function uint8ToBin(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i] ?? 0);
  return s;
}

function binToUint8(s: string): Uint8Array {
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
  return u;
}
