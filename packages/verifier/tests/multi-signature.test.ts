import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Multi-firma enumeration tests for @firma-ec/verifier (v0.7.1+).
 *
 * Structural-only — imports `../src/pdf` and avoids `../src/index` so we
 * don't pull in @firma-ec/tsl-ec (which fails workspace resolution under
 * vitest unless `pnpm install` has been run). The aggregate
 * `verifyAllSignatures` is exercised by integration tests once the workspace
 * is fully linked.
 */
import { describe, expect, test } from 'vitest';

import { findAllSignatures, findSignature } from '../src/pdf';

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('findAllSignatures', () => {
  test('returns empty array for unsigned PDF (does not throw)', async () => {
    const unsigned = await readFile(resolve(FIX, 'unsigned.pdf'));
    const sigs = await findAllSignatures(new Uint8Array(unsigned));
    expect(sigs).toEqual([]);
  });

  test('returns exactly 1 entry for a single-signed PDF', async () => {
    const signed = await readFile(resolve(FIX, 'bb-valid.pdf'));
    const bytes = new Uint8Array(signed);
    const all = await findAllSignatures(bytes);
    expect(all).toHaveLength(1);
    expect(all[0]!.byteRange[0]).toBe(0);
    expect(all[0]!.contents.length).toBeGreaterThan(0);
  });

  test('findSignature returns the first entry (back-compat with single-sig)', async () => {
    const signed = await readFile(resolve(FIX, 'bb-valid.pdf'));
    const bytes = new Uint8Array(signed);
    const first = await findSignature(bytes);
    const all = await findAllSignatures(bytes);
    expect(first).not.toBeNull();
    expect(first!.byteRange).toEqual(all[0]!.byteRange);
    expect(Array.from(first!.contents)).toEqual(Array.from(all[0]!.contents));
  });

  test('rejects non-PDF bytes with header error', async () => {
    await expect(findAllSignatures(new Uint8Array([0x00, 0x01, 0x02]))).rejects.toThrow(
      /missing %PDF/,
    );
  });

  // Multi-firma integration test with a real cryptographically-valid 2/3-sig
  // PDF lives in `signer/tests/incremental.test.ts` (it already generates the
  // fixture). Wiring it into the verifier suite is tracked as a follow-up;
  // running findAllSignatures on that signer-produced output should yield
  // N entries with non-zero /Contents and increasing /ByteRange[1].
});
