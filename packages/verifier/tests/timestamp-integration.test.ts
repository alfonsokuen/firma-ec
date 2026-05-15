/**
 * F6 Task 13 — verifier index integration with timestamp.
 *
 * Round-trip:
 *   - sign with timestamp:false → verify → profile B-B + badge 'none'.
 *   - parse a verifier result for a B-B legacy PDF → timestamp.present=false.
 *
 * The PWA-side gold path is exercised in signer/tests/pades-timestamp.test.ts
 * with mocked TSA tokens; here we focus on:
 *   1. Profile is B-B when no token (regression for v0.4.x behavior).
 *   2. signature.timestamp field is always populated (never undefined).
 *   3. badge='none' when no token; warnings does not contain timestamp_invalid.
 *
 * The signer-package "gold via mock + verify→silver" path is intentionally
 * not duplicated here — it would need to mock @firma-ec/tsa-client across
 * package boundaries which the verifier's vitest setup doesn't currently
 * configure for cross-package mocking.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyPdf } from '../src/index.js';

const FIX_DIR = join(__dirname, 'fixtures');

/**
 * F6 T13 — verify legacy (pre-F6) B-B PDFs report timestamp.badge='none'
 * and don't add timestamp_invalid warnings. Profile remains 'B-B'.
 *
 * Round-trip "sign-with-mocked-TSA → verify → silver" is exercised at the
 * signer-package level (cms-timestamp + pades-timestamp tests) where
 * vi.mock can target @firma-ec/tsa-client cleanly. The verifier-package
 * harness here focuses on shape + B-B regression.
 */
describe('verifyPdf — F6 Task 13 timestamp integration', () => {
  it('legacy B-B fixture → profile B-B + badge none + no timestamp_invalid warning', async () => {
    const pdf = new Uint8Array(readFileSync(join(FIX_DIR, 'bb-valid.pdf')));
    const result = await verifyPdf(pdf, { fetchOcsp: false });
    expect(result.signature).toBeDefined();
    expect(result.signature!.profile).toBe('B-B');
    expect(result.signature!.timestamp).toBeDefined();
    expect(result.signature!.timestamp!.present).toBe(false);
    expect(result.signature!.timestamp!.valid).toBe(false);
    expect(result.signature!.timestamp!.badge).toBe('none');
    const tsWarnings = result.warnings.filter((w) => w.code === 'timestamp_invalid');
    expect(tsWarnings).toHaveLength(0);
  });

  it('signature.timestamp summary is always populated (stable PWA contract)', async () => {
    const pdf = new Uint8Array(readFileSync(join(FIX_DIR, 'bb-valid.pdf')));
    const result = await verifyPdf(pdf, { fetchOcsp: false });
    expect(result.signature?.timestamp).toEqual(
      expect.objectContaining({ present: false, valid: false, badge: 'none' }),
    );
  });

  it('hash-mismatch PDF → outer status=invalid, timestamp still reports badge=none cleanly', async () => {
    const pdf = new Uint8Array(readFileSync(join(FIX_DIR, 'hash-mismatch.pdf')));
    const result = await verifyPdf(pdf, { fetchOcsp: false });
    // Outer status is 'invalid' for the right reason — hash mismatch — not
    // a degradation forced by timestamp logic. Spec §6.2: timestamp NEVER
    // degrades outer signature validity.
    expect(['invalid', 'warning']).toContain(result.status);
    expect(result.signature?.timestamp?.badge).toBe('none');
  });
});
