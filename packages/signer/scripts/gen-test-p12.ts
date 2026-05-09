/**
 * Generate synthetic .p12 fixtures for @firma-ec/signer tests.
 *
 * Run:
 *   node --experimental-strip-types packages/signer/scripts/gen-test-p12.ts
 *
 * Outputs (PIN = "test1234" for all):
 *   tests/fixtures/rsa2048-valid.p12      — RSA-2048 self-signed, valid 1y
 *   tests/fixtures/rsa1024-weak.p12       — RSA-1024 (weak, parsePfx accepts; signer should reject)
 *   tests/fixtures/ecdsa-p256-valid.p12   — ECDSA P-256 self-signed, valid 1y
 *   tests/fixtures/cert-expired.p12       — RSA-2048, notAfter in the past
 *   tests/fixtures/cert-not-yet-valid.p12 — RSA-2048, notBefore in the future
 *   tests/fixtures/corrupt.p12            — random bytes (not a valid PFX)
 *
 * RSA fixtures use node-forge (full PKCS#12 wrapper).
 * ECDSA fixture uses Node's webcrypto + pkijs (forge has no EC PKCS#12 support).
 *
 * @see packages/signer/src/p12.ts
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import forge from 'node-forge';

// Wire pkijs to Node's webcrypto
pkijs.setEngine(
  'node-webcrypto',
  new pkijs.CryptoEngine({ name: 'node-webcrypto', crypto: webcrypto as unknown as Crypto }),
);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(SCRIPT_DIR, '..', 'tests', 'fixtures');
const PIN = 'test1234';

if (!existsSync(FIXTURES_DIR)) mkdirSync(FIXTURES_DIR, { recursive: true });

/* ─────────────────────────────────────────────────────────────────────
 * RSA fixtures via node-forge
 * ────────────────────────────────────────────────────────────────── */

interface RsaP12Opts {
  bits: 1024 | 2048;
  cn: string;
  notBefore: Date;
  notAfter: Date;
  filename: string;
  /**
   * PKCS#12 cipher for the encrypted SafeContents + shrouded key bag.
   *  - 'aes256' (default): modern PBES2+AES-256-CBC. Pkijs/Web Crypto can read.
   *  - '3des':  legacy `pbeWithSHAAnd3-KeyTripleDES-CBC` — what real-world Ecuadorian
   *             ECIs (BCE, Security Data, ArgosData, ANFAC) emit. Web Crypto cannot
   *             decrypt this; only the v0.4.3 node-forge backend can.
   */
  algorithm?: 'aes256' | '3des';
}

function genRsaP12(opts: RsaP12Opts): void {
  const keys = forge.pki.rsa.generateKeyPair({ bits: opts.bits, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + Math.floor(Math.random() * 1e9).toString(16).padStart(8, '0');
  cert.validity.notBefore = opts.notBefore;
  cert.validity.notAfter = opts.notAfter;
  const attrs = [
    { name: 'commonName', value: opts.cn },
    { name: 'countryName', value: 'EC' },
    { name: 'organizationName', value: 'firma-ec test fixture' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, keyEncipherment: true },
    { name: 'extKeyUsage', clientAuth: true, codeSigning: true },
  ]);
  // Self-sign with SHA-256 (forge default for RSA is SHA-1; force SHA-256)
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], PIN, {
    algorithm: opts.algorithm ?? 'aes256',
    useMac: true,
    count: 2048,
  });
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  const out = Buffer.from(p12Der, 'binary');
  const outPath = join(FIXTURES_DIR, opts.filename);
  writeFileSync(outPath, out);
  console.log(`  ✓ ${opts.filename} (${out.length} bytes)`);
}

/* ─────────────────────────────────────────────────────────────────────
 * ECDSA fixture: cert via pkijs (self-sign with ECDSA-SHA256), but wrap
 * the PFX manually using node-forge primitives so the resulting PFX is
 * fully forge-readable (matches what real CAs emit).
 *
 * v0.4.7: previous version used pkijs end-to-end which produced an
 * EncryptedPrivateKeyInfo with OCTET STRING constructed=true that node-forge
 * rejects on read. Fix: use forge.pki.encryptPrivateKeyInfo on the PKCS#8
 * (it accepts an arbitrary inner ASN.1 — RSA assumption isn't enforced),
 * yielding a forge-canonical OCTET STRING constructed=false form.
 * ────────────────────────────────────────────────────────────────── */

async function genEcdsaP12(filename: string): Promise<void> {
  // 1. Generate ECDSA P-256 keypair via webcrypto
  const keyPair = (await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;

  const pkcs8 = await webcrypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  const spki = await webcrypto.subtle.exportKey('spki', keyPair.publicKey);

  // 2. Self-signed X.509 cert via pkijs (forge can't sign EC)
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: Date.now() });

  const cn = new pkijs.AttributeTypeAndValue({
    type: '2.5.4.3',
    value: new asn1js.Utf8String({ value: 'Test Signer ECDSA' }),
  });
  cert.subject.typesAndValues.push(cn);
  cert.issuer.typesAndValues.push(cn);

  const now = new Date();
  cert.notBefore.value = new Date(now.getTime() - 60_000);
  cert.notAfter.value = new Date(now.getTime() + 365 * 24 * 3600 * 1000);

  const spkiAsn1 = asn1js.fromBER(spki);
  cert.subjectPublicKeyInfo = new pkijs.PublicKeyInfo({ schema: spkiAsn1.result });

  await cert.sign(keyPair.privateKey, 'SHA-256');

  const certDer = cert.toSchema().toBER(false);

  // 3. Build PFX manually with forge primitives:
  //    PFX
  //    └── AuthenticatedSafe (SEQUENCE OF ContentInfo)
  //        ├── ContentInfo(data) → SafeContents [ CertBag(certDer) ]
  //        └── ContentInfo(data) → SafeContents [ PKCS8ShroudedKeyBag(EncryptedPrivateKeyInfo) ]
  //
  // For the key, we feed the PKCS#8 PrivateKeyInfo (ECDSA) into forge's
  // encryptPrivateKeyInfo — it just encrypts whatever ASN.1 we give it,
  // emitting the canonical OCTET STRING constructed=false form forge expects.

  const { asn1, pki, pkcs12, util } = forge;

  // Parse the webcrypto PKCS#8 DER as forge ASN.1
  const pkcs8Bin = arrayBufferToBinaryString(pkcs8);
  const pkcs8Asn1 = asn1.fromDer(util.createBuffer(pkcs8Bin), false);

  // Encrypt with PBES2 + AES-256
  const encryptedPkInfo = pki.encryptPrivateKeyInfo(pkcs8Asn1, PIN, {
    algorithm: 'aes256',
    count: 2048,
    saltSize: 8,
    prfAlgorithm: 'sha256',
  });

  // SafeBag (pkcs8ShroudedKeyBag) for the encrypted key
  const SHROUDED_KEY_BAG_OID = '1.2.840.113549.1.12.10.1.2';
  const CERT_BAG_OID = '1.2.840.113549.1.12.10.1.3';
  const X509_CERT_BAG_OID = '1.2.840.113549.1.9.22.1';
  const DATA_OID = '1.2.840.113549.1.7.1';

  const keySafeBag = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(SHROUDED_KEY_BAG_OID).getBytes()),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [encryptedPkInfo]),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, []),
  ]);

  // SafeBag (certBag → x509Certificate)
  const certBin = arrayBufferToBinaryString(certDer);
  const certBag = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(CERT_BAG_OID).getBytes()),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(X509_CERT_BAG_OID).getBytes()),
        asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, certBin),
        ]),
      ]),
    ]),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, []),
  ]);

  // SafeContents = SEQUENCE OF SafeBag
  const certSafeContents = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [certBag]);
  const keySafeContents = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [keySafeBag]);

  // Each SafeContents wrapped in ContentInfo(data) — content = OCTET STRING(SafeContents DER)
  function dataContentInfo(safeContents: forge.asn1.Asn1): forge.asn1.Asn1 {
    return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(DATA_OID).getBytes()),
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, asn1.toDer(safeContents).getBytes()),
      ]),
    ]);
  }

  const authSafe = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    dataContentInfo(certSafeContents),
    dataContentInfo(keySafeContents),
  ]);
  const authSafeDer = asn1.toDer(authSafe).getBytes();

  // ContentInfo wrapping the AuthenticatedSafe (type=data)
  const authSafeContentInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(DATA_OID).getBytes()),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, authSafeDer),
    ]),
  ]);

  // MacData — HMAC-SHA1 over authSafeDer using PKCS#12 KDF
  const macSalt = forge.random.getBytesSync(8);
  const macIterations = 2048;
  // forge.pkcs12.generateKey produces a PKCS#12-derived key; for MAC use id=3.
  // md param must be a digest *object*, not a string — pass undefined to default to sha1.
  const macKey = pkcs12.generateKey(PIN, util.createBuffer(macSalt), 3, macIterations, 20);
  const hmac = forge.hmac.create();
  hmac.start('sha1', macKey);
  hmac.update(authSafeDer);
  const macDigest = hmac.digest().getBytes();

  const macData = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    // DigestInfo
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(pki.oids['sha1'] as string).getBytes()),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
      ]),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, macDigest),
    ]),
    // macSalt
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, macSalt),
    // iterations
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(macIterations).getBytes()),
  ]);

  // PFX = SEQUENCE { version=3, authSafeCI, macData }
  const pfx = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(3).getBytes()),
    authSafeContentInfo,
    macData,
  ]);

  const pfxDer = asn1.toDer(pfx).getBytes();
  const out = Buffer.from(pfxDer, 'binary');
  const outPath = join(FIXTURES_DIR, filename);
  writeFileSync(outPath, out);
  console.log(`  ✓ ${filename} (${out.length} bytes)`);
}

function arrayBufferToBinaryString(ab: ArrayBuffer): string {
  const u8 = new Uint8Array(ab);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i] as number);
  return s;
}

function pinToAB(pin: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(pin);
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

/* ─────────────────────────────────────────────────────────────────────
 * Driver
 * ────────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const now = new Date();
  const oneYear = 365 * 24 * 3600 * 1000;

  console.log('Generating .p12 fixtures →', FIXTURES_DIR);

  console.log('  • RSA-2048 valid');
  genRsaP12({
    bits: 2048,
    cn: 'Test Signer RSA-2048',
    notBefore: new Date(now.getTime() - 60_000),
    notAfter: new Date(now.getTime() + oneYear),
    filename: 'rsa2048-valid.p12',
  });

  console.log('  • RSA-1024 weak');
  genRsaP12({
    bits: 1024,
    cn: 'Test Signer RSA-1024 (weak)',
    notBefore: new Date(now.getTime() - 60_000),
    notAfter: new Date(now.getTime() + oneYear),
    filename: 'rsa1024-weak.p12',
  });

  console.log('  • RSA-2048 expired');
  genRsaP12({
    bits: 2048,
    cn: 'Test Signer Expired',
    notBefore: new Date(now.getTime() - 2 * oneYear),
    notAfter: new Date(now.getTime() - oneYear), // already past
    filename: 'cert-expired.p12',
  });

  console.log('  • RSA-2048 not-yet-valid');
  genRsaP12({
    bits: 2048,
    cn: 'Test Signer Future',
    notBefore: new Date(now.getTime() + oneYear), // in the future
    notAfter: new Date(now.getTime() + 2 * oneYear),
    filename: 'cert-not-yet-valid.p12',
  });

  // P0 FIX (v0.4.3): real-world Ecuadorian ECIs (BCE, Security Data, ArgosData, ANFAC)
  // emit .p12 cifrados con `pbeWithSHAAnd3-KeyTripleDES-CBC` (3DES). This fixture
  // pins coverage of that path so a future regression away from node-forge would fail.
  console.log('  • RSA-2048 3DES legacy (Ecuadorian ECI shape)');
  genRsaP12({
    bits: 2048,
    cn: 'Test Signer 3DES Legacy EC',
    notBefore: new Date(now.getTime() - 60_000),
    notAfter: new Date(now.getTime() + oneYear),
    filename: 'rsa2048-3des-legacy.p12',
    algorithm: '3des',
  });

  console.log('  • ECDSA P-256 valid');
  await genEcdsaP12('ecdsa-p256-valid.p12');

  console.log('  • Corrupt random bytes');
  const corrupt = webcrypto.getRandomValues(new Uint8Array(512));
  writeFileSync(join(FIXTURES_DIR, 'corrupt.p12'), Buffer.from(corrupt));
  console.log(`  ✓ corrupt.p12 (${corrupt.length} bytes)`);

  console.log('\nDone. PIN for all valid fixtures: "test1234"');
}

main().catch((err) => {
  console.error('Fixture generation failed:', err);
  process.exit(1);
});
