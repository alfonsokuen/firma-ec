import { fromBER } from 'asn1js';
import { describe, expect, test } from 'vitest';
import { hexToBytes } from '../src/pdf';

/**
 * Regression: /Contents extraction must strip only the PAdES reserved zero
 * padding, by reading the real length from the outer ASN.1 header — NOT by
 * blindly trimming trailing 0x00.
 *
 * Two real-world failure shapes this locks:
 *   1. BER indefinite-length CMS (0x30 0x80 … 0x00 0x00 EOC). A blind trailing
 *      zero trim eats the end-of-contents octets → asn1js fromBER offset -1.
 *      Observed on Ecuadorian "Carta…_signed.pdf" and the 2nd signature of an
 *      ACTA — both 30 80-encoded PKCS#7.
 *   2. Definite-length CMS whose last content byte is a legitimate 0x00 (e.g. a
 *      trailing INTEGER 0). A blind trim removes a byte inside the declared
 *      length → fromBER offset -1.
 */

function hexOf(b: number[]): string {
  return b.map((x) => x.toString(16).padStart(2, '0')).join('');
}

describe('hexToBytes — ASN.1-length-aware /Contents extraction', () => {
  test('BER indefinite-length: EOC octets survive, fromBER parses', () => {
    // SEQUENCE indefinite { SEQUENCE { INTEGER 5 } } EOC, then PAdES zero padding.
    const der = [0x30, 0x80, 0x30, 0x03, 0x02, 0x01, 0x05, 0x00, 0x00];
    const padded = [...der, 0, 0, 0, 0, 0, 0]; // reserved /Contents space
    const out = hexToBytes(hexOf(padded));
    // Must NOT have trimmed away the 0x00 0x00 EOC.
    const parsed = fromBER(
      out.buffer.slice(out.byteOffset, out.byteOffset + out.length) as ArrayBuffer,
    );
    expect(parsed.offset).toBeGreaterThan(0); // legacy trim would give -1
    expect(parsed.offset).toBe(der.length);
  });

  test('definite-length ending in 0x00: last content byte is preserved', () => {
    // SEQUENCE { INTEGER 0 } — the INTEGER's value byte is 0x00 and is INSIDE
    // the declared length. Padding follows.
    const der = [0x30, 0x03, 0x02, 0x01, 0x00];
    const padded = [...der, 0, 0, 0];
    const out = hexToBytes(hexOf(padded));
    expect(Array.from(out)).toEqual(der); // exactly the encoded structure, no over-trim
    const parsed = fromBER(
      out.buffer.slice(out.byteOffset, out.byteOffset + out.length) as ArrayBuffer,
    );
    expect(parsed.offset).toBe(der.length);
  });

  test('long-form definite length: exact slice, padding stripped', () => {
    // SEQUENCE (long form 0x81 0x04) { 4 content bytes }, then padding.
    const der = [0x30, 0x81, 0x04, 0x01, 0x02, 0x03, 0x04];
    const padded = [...der, 0, 0, 0, 0, 0];
    const out = hexToBytes(hexOf(padded));
    expect(Array.from(out)).toEqual(der);
  });
});
