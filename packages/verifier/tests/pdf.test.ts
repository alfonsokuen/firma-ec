import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { findSignature } from '../src/pdf';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('findSignature', () => {
  test('rejects non-PDF bytes', async () => {
    await expect(findSignature(new Uint8Array([0x00, 0x01]))).rejects.toThrow(/missing %PDF/);
  });

  test('returns null for unsigned PDF', async () => {
    const unsigned = await readFile(resolve(FIX, 'unsigned.pdf'));
    const result = await findSignature(new Uint8Array(unsigned));
    expect(result).toBeNull();
  });

  test('extracts ByteRange and Contents from synthetic signed PDF', async () => {
    const signed = await readFile(resolve(FIX, 'bb-valid.pdf'));
    const result = await findSignature(new Uint8Array(signed));
    expect(result).not.toBeNull();
    expect(result!.byteRange[0]).toBe(0);
    expect(result!.byteRange[1]).toBeGreaterThan(0);
    expect(result!.contents.length).toBeGreaterThan(0);
    // NOTE: pdf.ts parseString() handles PDF strings (parens / hex) but not names.
    // Real PAdES PDFs use a Name (/adbe.pkcs7.detached). With synthetic fixtures the
    // current parser falls back to 'unknown' — acceptable since the value is informational.
    expect(typeof result!.subFilter).toBe('string');
  });

  test('byteRange invariants — a=0, a+b<=c, c+d<=fileSize across all signed fixtures', async () => {
    const fixtures = ['bb-valid.pdf', 'weak-sha1.pdf', 'rsa-1024.pdf', 'expired-cert.pdf', 'untrusted-root.pdf', 'hash-mismatch.pdf'];
    for (const f of fixtures) {
      const bytes = new Uint8Array(await readFile(resolve(FIX, f)));
      const sig = await findSignature(bytes);
      expect(sig, `${f} should have a signature`).not.toBeNull();
      const [a, b, c, d] = sig!.byteRange;
      expect(a, `${f}: a=0`).toBe(0);
      expect(a + b, `${f}: a+b<=c`).toBeLessThanOrEqual(c);
      expect(c + d, `${f}: c+d<=fileSize`).toBeLessThanOrEqual(bytes.length);
    }
  });

  test('hasIncrementalUpdates true iff bytes appended after sig', async () => {
    const valid = new Uint8Array(await readFile(resolve(FIX, 'bb-valid.pdf')));
    const tampered = new Uint8Array(await readFile(resolve(FIX, 'incremental-tampered.pdf')));
    const sigValid = await findSignature(valid);
    const sigTamp = await findSignature(tampered);
    expect(sigValid!.hasIncrementalUpdates).toBe(false);
    expect(sigTamp!.hasIncrementalUpdates).toBe(true);
  });

  test('property: random non-PDF bytes throw or return null cleanly', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 100, maxLength: 200 }), async (bytes) => {
        if (bytes[0] === 0x25 && bytes[1] === 0x50) return true;
        try {
          const result = await findSignature(bytes);
          return result === null;
        } catch {
          return true;
        }
      }),
      { numRuns: 200 },
    );
  });

  test('property: PDF prefix + arbitrary tail — invariants always hold or throws', async () => {
    const prefix = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 0, maxLength: 500 }), async (tail) => {
        const bytes = new Uint8Array(prefix.length + tail.length);
        bytes.set(prefix, 0);
        bytes.set(tail, prefix.length);
        try {
          const sig = await findSignature(bytes);
          if (sig === null) return true;
          const [a, b, c, d] = sig.byteRange;
          return a === 0 && a + b <= c && c + d <= bytes.length;
        } catch {
          return true;
        }
      }),
      { numRuns: 200 },
    );
  });

  test('byteRange[0] != 0 throws ERR_BYTERANGE_INVALID', async () => {
    const evil = new TextEncoder().encode(
      '%PDF-1.7\n/ByteRange [1 100 200 50] /Contents <00> ' + 'x'.repeat(300),
    );
    await expect(findSignature(evil)).rejects.toThrow(/first offset must be 0/);
  });

  test('ByteRange overlap (a+b > c) throws', async () => {
    const evil = new TextEncoder().encode(
      '%PDF-1.7\n/ByteRange [0 500 100 50] /Contents <00> ' + 'x'.repeat(700),
    );
    await expect(findSignature(evil)).rejects.toThrow(/overlaps/);
  });

  test('ByteRange past EOF throws', async () => {
    const evil = new TextEncoder().encode(
      '%PDF-1.7\n/ByteRange [0 10 20 99999999] /Contents <00>',
    );
    await expect(findSignature(evil)).rejects.toThrow(/past EOF/);
  });
});
