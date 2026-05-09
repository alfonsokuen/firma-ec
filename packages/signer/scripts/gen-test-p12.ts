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
    algorithm: 'aes256', // pkijs Web Crypto engine supports PBES2+AES; rejects legacy 3DES PBE
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
 * ECDSA fixture via Node webcrypto + pkijs
 * ────────────────────────────────────────────────────────────────── */

async function genEcdsaP12(filename: string): Promise<void> {
  // 1. Generate ECDSA P-256 keypair
  const keyPair = (await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true, // extractable: true so we can export PKCS#8
    ['sign', 'verify'],
  )) as CryptoKeyPair;

  const pkcs8 = await webcrypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  const spki = await webcrypto.subtle.exportKey('spki', keyPair.publicKey);

  // 2. Build a self-signed X.509 certificate using pkijs
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

  // Import the SPKI into pkijs PublicKeyInfo
  const spkiAsn1 = asn1js.fromBER(spki);
  cert.subjectPublicKeyInfo = new pkijs.PublicKeyInfo({ schema: spkiAsn1.result });

  // Self-sign with ECDSA-SHA256
  await cert.sign(keyPair.privateKey, 'SHA-256');

  // 3. Build the PFX:
  //    PFX
  //    └── AuthenticatedSafe
  //        ├── SafeContents (data)              ← contains CertBag
  //        └── SafeContents (data)              ← contains PKCS8ShroudedKeyBag
  //
  // We use the simpler "data" ContentInfo for both (no password-encrypted SafeContents),
  // but the key inside is wrapped in a PKCS8ShroudedKeyBag (password-encrypted).
  // This matches what most CA-issued .p12 files look like.

  const certBag = new pkijs.SafeBag({
    bagId: '1.2.840.113549.1.12.10.1.3', // certBag
    bagValue: new pkijs.CertBag({
      parsedValue: cert,
    }),
  });
  // Hydrate CertBag.certValue from cert
  (certBag.bagValue as pkijs.CertBag).certValue = new pkijs.Certificate({ schema: cert.toSchema() });

  // Shrouded key bag
  const shroudedKeyBag = new pkijs.PKCS8ShroudedKeyBag({
    parsedValue: new pkijs.PrivateKeyInfo({ schema: asn1js.fromBER(pkcs8).result }),
  });
  await shroudedKeyBag.makeInternalValues({
    password: pinToAB(PIN),
    contentEncryptionAlgorithm: { name: 'AES-CBC', length: 256 },
    hmacHashAlgorithm: 'SHA-256',
    iterationCount: 2048,
  });

  const keyBagWrapper = new pkijs.SafeBag({
    bagId: '1.2.840.113549.1.12.10.1.2', // pkcs8ShroudedKeyBag
    bagValue: shroudedKeyBag,
  });

  const safeContentsCerts = new pkijs.SafeContents({ safeBags: [certBag] });
  const safeContentsKeys = new pkijs.SafeContents({ safeBags: [keyBagWrapper] });

  const authSafe = new pkijs.AuthenticatedSafe({
    safeContents: [
      // Each SafeContents is wrapped in a ContentInfo of type "data"
      new pkijs.ContentInfo({
        contentType: '1.2.840.113549.1.7.1', // data
        content: new asn1js.OctetString({ valueHex: safeContentsCerts.toSchema().toBER(false) }),
      }),
      new pkijs.ContentInfo({
        contentType: '1.2.840.113549.1.7.1',
        content: new asn1js.OctetString({ valueHex: safeContentsKeys.toSchema().toBER(false) }),
      }),
    ],
  });

  const pfx = new pkijs.PFX({
    parsedValue: {
      integrityMode: 0, // password-based MAC integrity
      authenticatedSafe: authSafe,
    },
  });
  await pfx.makeInternalValues({
    password: pinToAB(PIN),
    iterations: 2048,
    pbkdf2HashAlgorithm: { name: 'SHA-256' },
    hmacHashAlgorithm: 'SHA-256',
  });

  const der = pfx.toSchema().toBER(false);
  const out = Buffer.from(new Uint8Array(der));
  const outPath = join(FIXTURES_DIR, filename);
  writeFileSync(outPath, out);
  console.log(`  ✓ ${filename} (${out.length} bytes)`);
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
