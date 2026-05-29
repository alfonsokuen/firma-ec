import { describe, expect, test } from 'vitest';
import { findAllSignatures } from '../src/pdf';

/**
 * byterange-contents-before.test.ts — regression for the 2026-05-29 finding.
 *
 * Some Ecuadorian ECIs (Security Data, BCE) order the signature dictionary with
 * `/Contents <hex>` BEFORE `/ByteRange`. The old parser searched for /Contents
 * only FORWARD from the /ByteRange token, so it missed the hex entirely and
 * threw `byterange_invalid: /Contents not found`. The fix extracts the hex
 * straight from the unsigned gap [a+b, c), which is producer-order-independent.
 */

function toBytes(s: string): Uint8Array {
  return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
}

describe('findAllSignatures — /Contents before /ByteRange', () => {
  test('extracts the signature hex from the ByteRange gap regardless of dict order', async () => {
    // Real CMS bytes (ends in a non-zero byte so the PAdES zero-padding trim
    // in hexToBytes doesn't eat into them), then zero-padded to the reserved
    // /Contents window length (as real signers do).
    const base = 'DEADBEEFCAFE0102030405060708090A0B0C0D0E0F';
    const hex = base.padEnd(120, '0');

    // Dict lists /Contents BEFORE /ByteRange (the failing producer layout).
    const prefix = '%PDF-1.4\n<< /Type /Sig /SubFilter /ETSI.CAdES.detached /Contents ';
    const contentsField = `<${hex}>`;
    // 7-digit zero-padded placeholders so we can patch exact offsets without
    // changing the file length (the /ByteRange \d+ regex accepts leading zeros).
    const tailTemplate = (b: number, c: number, d: number) =>
      ` /ByteRange [0 ${String(b).padStart(7, '0')} ${String(c).padStart(7, '0')} ${String(d).padStart(7, '0')}] >> %%EOF`;

    const b = prefix.length; // offset of '<' = a+b (a=0)
    const c = b + contentsField.length; // first byte after '>'
    // total length is fixed regardless of the numbers (all 7-digit padded):
    const totalFixed = prefix.length + contentsField.length + tailTemplate(0, 0, 0).length;
    const d = totalFixed - c;

    const pdf = toBytes(prefix + contentsField + tailTemplate(b, c, d));
    expect(pdf.length).toBe(totalFixed);

    const sigs = await findAllSignatures(pdf);
    expect(sigs.length).toBe(1);
    expect(sigs[0]!.byteRange).toEqual([0, b, c, d]);
    expect(sigs[0]!.subFilter).toBe('ETSI.CAdES.detached');

    // hexToBytes trims the reserved zero-padding, recovering the real CMS bytes.
    const got = Array.from(sigs[0]!.contents)
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    expect(got).toBe(base.toUpperCase());
  });
});
