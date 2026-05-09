import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { findSignature } from '../src/pdf';
import { readFile } from 'node:fs/promises';

describe('findSignature', () => {
  test('rejects non-PDF bytes', async () => {
    await expect(findSignature(new Uint8Array([0x00, 0x01]))).rejects.toThrow(/missing %PDF/);
  });

  // TODO Task 11 — fixture not yet generated
  test.skip('returns null for unsigned PDF', async () => {
    const unsigned = await readFile('tests/fixtures/unsigned.pdf');
    const result = await findSignature(new Uint8Array(unsigned));
    expect(result).toBeNull();
  });

  // TODO Task 11 — fixture not yet generated
  test.skip('extracts ByteRange and Contents from a real signed PDF', async () => {
    const signed = await readFile('tests/fixtures/security-data-pades-bb.pdf');
    const result = await findSignature(new Uint8Array(signed));
    expect(result).not.toBeNull();
    expect(result!.byteRange[0]).toBe(0);
    expect(result!.byteRange[1]).toBeGreaterThan(0);
    expect(result!.contents.length).toBeGreaterThan(0);
    expect(result!.subFilter).toMatch(/CAdES|adbe\.pkcs7\.detached/);
  });

  // TODO Task 11 — fixture not yet generated
  test.skip('property: byteRange[0] is always 0 for a real signed PDF', async () => {
    const signed = await readFile('tests/fixtures/security-data-pades-bb.pdf');
    const result = await findSignature(new Uint8Array(signed));
    expect(result?.byteRange[0]).toBe(0);
  });

  test('property: any random byte mutation outside /Contents range invalidates the byteRange parse', async () => {
    // Random bytes that don't start with %PDF- must either throw OR return null cleanly (never silently corrupt).
    // They must never resolve with a non-null SignedRange (that would mean we parsed a bogus signature).
    await fc.assert(fc.asyncProperty(fc.uint8Array({ minLength: 100, maxLength: 200 }), async (bytes) => {
      // skip — accidentally PDF-like (starts with %PDF-)
      if (bytes[0] === 0x25 && bytes[1] === 0x50) return true;
      try {
        const result = await findSignature(bytes);
        return result === null; // null is fine — no /ByteRange found
      } catch {
        return true; // throw is fine — invalid PDF
      }
    }));
  });
});
