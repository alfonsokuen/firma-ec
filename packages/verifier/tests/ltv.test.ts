/**
 * ltv.test.ts — F7 T25.
 *
 * Unit + regression tests for the LTV layer:
 *
 *  - B-T cross-val artifact (FreeTSA) → verifier reports profile === 'B-T',
 *    ltv.profile === 'B-B' (DSS absent), ltv.dssPresent === false. The
 *    regression guard for spec §9 (no profile downgrade).
 *  - B-B no-TSA artifact → profile 'B-B' on both axes.
 *  - extractDss on a fresh unsigned PDF returns undefined w/ no error.
 *  - extractDss on a B-T PDF returns undefined (no DSS yet) w/ no error.
 *
 * B-LT and B-LTA fixtures will be generated in Batch IV when the signer's
 * gen-f7-samples script is wired. For F7 Batch III we exercise the verify
 * path via parsed-DSS unit tests (synthetic ParsedDss shapes).
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { extractDss } from '../src/dss.js';
import { verifyPdf } from '../src/index.js';
import { verifyLtv } from '../src/ltv.js';

const FIX = resolve(__dirname, 'fixtures');

describe('F7 — DSS extraction (verifier)', () => {
  test('extractDss on B-T PDF (no DSS yet) returns undefined, no error', async () => {
    const bytes = new Uint8Array(await readFile(resolve(FIX, 'sample-b-t-freetsa.pdf')));
    const out = extractDss(bytes);
    expect(out.data).toBeUndefined();
    expect(out.error).toBeUndefined();
  });

  test('extractDss on B-B PDF (no DSS) returns undefined, no error', async () => {
    const bytes = new Uint8Array(await readFile(resolve(FIX, 'sample-b-b-no-tsa.pdf')));
    const out = extractDss(bytes);
    expect(out.data).toBeUndefined();
    expect(out.error).toBeUndefined();
  });

  test('extractDss on unsigned PDF returns undefined', async () => {
    const bytes = new Uint8Array(await readFile(resolve(FIX, 'unsigned.pdf')));
    const out = extractDss(bytes);
    expect(out.data).toBeUndefined();
  });
});

describe('F7 — verifyLtv synthetic shapes', () => {
  test('empty chain + no DSS → profile B-B, dssPresent false, no errors', async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
    const r = await verifyLtv([], undefined, new Uint8Array(0), pdfBytes);
    expect(r.profile).toBe('B-B');
    expect(r.dssPresent).toBe(false);
    expect(r.embeddedOcspCount).toBe(0);
    expect(r.embeddedCrlCount).toBe(0);
    expect(r.retrospectiveValid).toBe(false);
    expect(r.documentTimestamp).toBeUndefined();
  });

  test('DSS present but empty → profile B-T (caller bumps to B-T) + dss_present_but_empty error', async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const r = await verifyLtv(
      [],
      { certs: [], ocsps: [], crls: [], vri: {} },
      new Uint8Array(0),
      pdfBytes,
    );
    expect(r.dssPresent).toBe(true);
    expect(r.profile).toBe('B-T');
    expect(r.errors).toContain('dss_present_but_empty');
  });
});

describe('F7 — full verifyPdf regression', () => {
  test('B-T PDF (FreeTSA cross-val artifact) → profile B-T, ltv.profile B-B, no DSS, no downgrade', async () => {
    const bytes = new Uint8Array(await readFile(resolve(FIX, 'sample-b-t-freetsa.pdf')));
    const r = await verifyPdf(bytes, { fetchOcsp: false });
    // Critical regression guard (rule §9): outer profile MUST stay B-T even
    // though DSS is absent.
    expect(r.signature?.profile).toBe('B-T');
    expect(r.signature?.ltv).toBeDefined();
    expect(r.signature?.ltv?.profile).toBe('B-B');
    expect(r.signature?.ltv?.dssPresent).toBe(false);
    expect(r.signature?.ltv?.embeddedOcspCount).toBe(0);
    expect(r.signature?.ltv?.embeddedCrlCount).toBe(0);
    // Timestamp badge still gold (F6 invariant).
    expect(r.signature?.timestamp?.badge).toBe('gold');
  });

  test('B-B PDF (no TSA) → profile B-B on both axes', async () => {
    const bytes = new Uint8Array(await readFile(resolve(FIX, 'sample-b-b-no-tsa.pdf')));
    const r = await verifyPdf(bytes, { fetchOcsp: false });
    expect(r.signature?.profile).toBe('B-B');
    expect(r.signature?.ltv?.profile).toBe('B-B');
    expect(r.signature?.ltv?.dssPresent).toBe(false);
  });
});
