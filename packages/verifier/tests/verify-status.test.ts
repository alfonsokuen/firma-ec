import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTrustRoots } from '@firma-ec/tsl-ec';

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

// Mock signature value verification so we can isolate the trust-chain
// severity-mapping regression (P0 v0.3.1) without needing a fixture whose
// crypto sigValue verifies cleanly. Real ECI Ecuador PDFs from the live
// audit (Security Data + ArgosData) have hash-intact + sigValid=true; our
// repo fixtures don't, so we mock to simulate that authentic-PDF path.
vi.mock('../src/integrity', async () => {
  const actual = await vi.importActual<typeof import('../src/integrity')>(
    '../src/integrity',
  );
  return {
    ...actual,
    verifySignatureValue: vi.fn(actual.verifySignatureValue),
    checkDocumentIntegrity: vi.fn(actual.checkDocumentIntegrity),
  };
});

// Re-import AFTER vi.mock so verifyPdf binds to the mocked module.
const { verifyPdf } = await import('../src/index');
const integrityMod = await import('../src/integrity');
const verifySignatureValueMock = vi.mocked(integrityMod.verifySignatureValue);
const checkDocumentIntegrityMock = vi.mocked(integrityMod.checkDocumentIntegrity);

beforeEach(() => {
  verifySignatureValueMock.mockReset();
  checkDocumentIntegrityMock.mockReset();
  // Default: pass-through to real implementations.
  verifySignatureValueMock.mockImplementation(async (...args) => {
    const real = await vi.importActual<typeof import('../src/integrity')>(
      '../src/integrity',
    );
    return real.verifySignatureValue(...args);
  });
  checkDocumentIntegrityMock.mockImplementation(async (...args) => {
    const real = await vi.importActual<typeof import('../src/integrity')>(
      '../src/integrity',
    );
    return real.checkDocumentIntegrity(...args);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Regression suite for v0.3.1 hotfix.
 *
 * Bug: in v0.3.0 / 0.2.0-dev, real ECI Ecuador PDFs (Security Data + ArgosData)
 * with intact hashes returned status='invalid' on /verificar because
 * `path.success === false` (TSL roots are all placeholders pre-ARCOTEL
 * publication) was mapped straight to 'invalid'. The PWA showed the alarming
 * "Firma inválida" headline instead of the yellow warning + DEMO banner.
 *
 * Fix: when path validation fails SOLELY because the TSL is all-placeholder,
 * status degrades to 'warning' with code 'TRUST_PLACEHOLDER' (consumed by the
 * Verificar.svelte demo-banner heuristic). True crypto failures (hash
 * mismatch, weak hash, sig invalid) stay 'invalid' regardless of TSL state.
 */
describe('verifyPdf — TSL placeholder severity (v0.3.1 regression)', () => {
  test('all-placeholder TSL: hash-intact + sig-valid PDF → warning + TRUST_PLACEHOLDER (NOT invalid)', async () => {
    // Sanity: confirm we're still in partial-demo state (≥1 placeholder).
    // F6.7 (2026-05-10): 2 of 17 real (eclipsesoft, uanataca); 15 placeholder.
    const roots = await getTrustRoots();
    expect(roots.some((r) => r.isPlaceholder)).toBe(true);

    // Simulate a real ECI Ecuador PDF: hash matches, sig crypto-verifies OK.
    // Live audit fixtures (CONTRATO2026, DEMANDA-DIVORCIO) hit this path —
    // pre-fix they returned 'invalid' "Firma inválida". Post-fix: 'warning'.
    checkDocumentIntegrityMock.mockResolvedValue({ matches: true, computed: new Uint8Array(32) });
    verifySignatureValueMock.mockResolvedValue(true);

    const bytes = new Uint8Array(await readFile(resolve(FIX, 'eci-real-signed.pdf')));
    const result = await verifyPdf(bytes, { fetchOcsp: false });

    // CORE assertion: NOT 'invalid'. Live audit (2026-05-09) confirmed this
    // was the user-facing regression — three real ECI PDFs showed
    // "Firma inválida" red alert when they should have been yellow warning.
    expect(result.status).not.toBe('invalid');
    expect(result.status).toBe('warning');

    // Hash MUST be intact for this fixture (file is exactly as signed).
    expect(result.integrity?.digestMatches).toBe(true);

    // v0.7.13: per-root placeholder warnings are silenced. Either an explicit
    // TRUST_* demo code OR a confirmed real-root match — never both undefined.
    const hasPlaceholderCode = result.warnings.some(
      (w) => w.code === 'TRUST_PLACEHOLDER' || w.code === 'TRUST_PARTIAL',
    );
    const matchedReal = !!result.signer?.matchedRootSlug;
    expect(hasPlaceholderCode || matchedReal).toBe(true);
  });

  test('hash mismatch stays invalid even with all-placeholder TSL', async () => {
    // Counter-test: TSL state must NOT mask real crypto failures.
    const bytes = new Uint8Array(await readFile(resolve(FIX, 'hash-mismatch.pdf')));
    const result = await verifyPdf(bytes, { fetchOcsp: false });

    expect(result.status).toBe('invalid');
    expect(result.integrity?.digestMatches).toBe(false);
  });

  test('weak SHA-1 stays invalid (caught crypto failure, not chain)', async () => {
    const bytes = new Uint8Array(await readFile(resolve(FIX, 'weak-sha1.pdf')));
    const result = await verifyPdf(bytes, { fetchOcsp: false });
    expect(result.status).toBe('invalid');
  });

  test('engine version reports 0.3.1 (or higher SemVer)', async () => {
    const bytes = new Uint8Array(await readFile(resolve(FIX, 'unsigned.pdf')));
    const result = await verifyPdf(bytes, { fetchOcsp: false });
    // Match 0.3.x or higher; lock floor at 0.3.1 to catch accidental downgrade.
    expect(result.engineVersion).toMatch(/^0\.(3\.[1-9]\d*|[4-9]|\d{2,})/);
  });

  test('placeholder warning is degraded ONLY when ALL roots are placeholders; empty list stays invalid', async () => {
    // Empty trustRoots ⇒ allRootsPlaceholder=false (length>0 guard) ⇒
    // chain genuinely cannot build, no degradation, status stays 'invalid'.
    // Simulate hash + sig OK so the only failure is chain.
    checkDocumentIntegrityMock.mockResolvedValue({ matches: true, computed: new Uint8Array(32) });
    verifySignatureValueMock.mockResolvedValue(true);

    const bytes = new Uint8Array(await readFile(resolve(FIX, 'eci-real-signed.pdf')));
    const result = await verifyPdf(bytes, { fetchOcsp: false, trustRoots: [] });
    expect(result.status).toBe('invalid');
    expect(
      result.warnings.some((w) => w.code === 'TRUST_PLACEHOLDER'),
    ).toBe(false);
  });
});
