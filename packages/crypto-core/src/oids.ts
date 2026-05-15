// Subset of OIDs relevant to Ecuadorian PAdES verification.
// For unknown OIDs, the verifier returns the dotted form as fallback.

export const OID_NAMES: Record<string, string> = {
  // Hash algorithms
  '2.16.840.1.101.3.4.2.1': 'SHA-256',
  '2.16.840.1.101.3.4.2.2': 'SHA-384',
  '2.16.840.1.101.3.4.2.3': 'SHA-512',
  '1.3.14.3.2.26': 'SHA-1', // legacy, must reject

  // Signature algorithms
  '1.2.840.113549.1.1.11': 'sha256WithRSAEncryption',
  '1.2.840.113549.1.1.12': 'sha384WithRSAEncryption',
  '1.2.840.113549.1.1.13': 'sha512WithRSAEncryption',
  '1.2.840.113549.1.1.10': 'rsassa-pss',
  '1.2.840.10045.4.3.2': 'ecdsa-with-SHA256',
  '1.2.840.10045.4.3.3': 'ecdsa-with-SHA384',

  // Key types
  '1.2.840.113549.1.1.1': 'rsaEncryption',
  '1.2.840.10045.2.1': 'ecPublicKey',

  // X.500 attribute types
  '2.5.4.3': 'CN',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '2.5.4.42': 'GN',
  '2.5.4.4': 'SN',
  '2.5.4.5': 'serialNumber',
  '0.9.2342.19200300.100.1.25': 'DC',

  // Extensions
  '2.5.29.15': 'keyUsage',
  '2.5.29.17': 'subjectAltName',
  '2.5.29.19': 'basicConstraints',
  '2.5.29.31': 'cRLDistributionPoints',
  '2.5.29.32': 'certificatePolicies',
  '2.5.29.35': 'authorityKeyIdentifier',
  '2.5.29.37': 'extKeyUsage',
  '1.3.6.1.5.5.7.1.1': 'authorityInfoAccess',

  // Extended key usage
  '1.3.6.1.5.5.7.3.1': 'serverAuth',
  '1.3.6.1.5.5.7.3.2': 'clientAuth',
  '1.3.6.1.5.5.7.3.3': 'codeSigning',
  '1.3.6.1.5.5.7.3.4': 'emailProtection',
  '1.3.6.1.5.5.7.3.8': 'timeStamping',
  '1.3.6.1.5.5.7.3.9': 'OCSPSigning',

  // PAdES specific signed attributes
  '1.2.840.113549.1.9.3': 'contentType',
  '1.2.840.113549.1.9.4': 'messageDigest',
  '1.2.840.113549.1.9.5': 'signingTime',
  '1.2.840.113549.1.9.16.2.47': 'signingCertificateV2',
  '1.2.840.113549.1.9.16.2.14': 'pkcs9-at-signatureTimeStampToken',

  // OCSP
  '1.3.6.1.5.5.7.48.1': 'OCSP',
  '1.3.6.1.5.5.7.48.2': 'caIssuers',
};

export function oidName(oid: string): string {
  return OID_NAMES[oid] ?? oid;
}

export const REJECTED_HASH_OIDS = new Set([
  '1.3.14.3.2.26', // SHA-1
  '1.2.840.113549.2.5', // MD5
]);

export const REJECTED_SIG_OIDS = new Set([
  '1.2.840.113549.1.1.5', // sha1WithRSA
  '1.2.840.113549.1.1.4', // md5WithRSA
]);
