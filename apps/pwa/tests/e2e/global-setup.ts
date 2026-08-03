/**
 * global-setup.ts — generates an ephemeral RSA-2048 self-signed .p12 fixture
 * for the "modo guiado" F1 spike (real-signing e2e coverage).
 *
 * Why generated at test-run time instead of committed: this is a throwaway
 * signing key with a well-known password. It carries zero real-world value
 * (self-signed, CN "Prueba E2E", not chained to any CA/TSL), but committing
 * *any* .p12 to git is unnecessary residual risk — generating it fresh each
 * run costs <50ms and leaves nothing in history to ever worry about.
 *
 * Mirrors packages/signer/scripts/gen-test-p12.ts (same node-forge recipe,
 * same fixture shape: RSA-2048, PBES2+AES-256 PKCS#12, PIN "test1234").
 * `node-forge` does NOT resolve from the repo root or transitively through
 * @firma-ec/signer's public API — it had to be added as a devDependency of
 * @firma-ec/pwa itself (see apps/pwa/package.json) for this script to import it.
 *
 * @see apps/pwa/playwright.config.ts (globalSetup wiring)
 * @see apps/pwa/tests/e2e/spike-sign.spec.ts (consumer)
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import forge from 'node-forge';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, 'fixtures', 'generated');
const OUT_FILE = join(OUT_DIR, 'test-signer.p12');

/**
 * PIN for the generated fixture. Intentionally a fixed, non-secret literal —
 * this key is regenerated from scratch on every test run, is never chained to
 * any real trust anchor, and never leaves the local machine / CI runner.
 * Matches the PIN used by the sibling fixtures in packages/signer/tests/fixtures/.
 */
const E2E_TEST_P12_PIN = 'test1234';

function generateSelfSignedP12(): Buffer {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = `01${Math.floor(Math.random() * 1e9)
    .toString(16)
    .padStart(8, '0')}`;
  const now = new Date();
  cert.validity.notBefore = new Date(now.getTime() - 60_000);
  cert.validity.notAfter = new Date(now.getTime() + 365 * 24 * 3600 * 1000);
  const attrs = [
    { name: 'commonName', value: 'Prueba E2E' },
    { name: 'countryName', value: 'EC' },
    { name: 'organizationName', value: 'firma-ec e2e spike (modo guiado F1)' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, keyEncipherment: true },
    { name: 'extKeyUsage', clientAuth: true, codeSigning: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], E2E_TEST_P12_PIN, {
    algorithm: 'aes256',
    useMac: true,
    count: 2048,
  });
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  return Buffer.from(p12Der, 'binary');
}

export default function globalSetup(): void {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const p12 = generateSelfSignedP12();
  writeFileSync(OUT_FILE, p12);
  // globalSetup runs in plain Node before the test runner reporter attaches;
  // console.log is the only visibility into fixture generation (mirrors the
  // convention in packages/signer/scripts/gen-test-p12.ts).
  // biome-ignore lint/suspicious/noConsole: intentional — see comment above.
  console.log(`[global-setup] generated ephemeral e2e .p12 → ${OUT_FILE} (${p12.length} bytes)`);
}
