import * as asn1js from 'asn1js';
import fc from 'fast-check';
import * as pkijs from 'pkijs';
import { describe, expect, it } from 'vitest';
import { buildTimeStampReq } from '../src/request';

describe('buildTimeStampReq — round-trip property', () => {
  it('any 32-byte imprint round-trips through pkijs.TimeStampReq', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), (imprintArr) => {
        const imprint = new Uint8Array(imprintArr);
        const nonce = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
        const der = buildTimeStampReq(imprint, 'SHA-256', nonce);
        const ab = der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer;
        const parsed = asn1js.fromBER(ab);
        expect(parsed.offset).not.toBe(-1);
        const tsq = new pkijs.TimeStampReq({ schema: parsed.result });
        const view = (
          tsq.messageImprint.hashedMessage as unknown as {
            valueBlock: { valueHexView?: Uint8Array; valueHex?: ArrayBuffer };
          }
        ).valueBlock;
        const out = view.valueHexView ?? new Uint8Array(view.valueHex as ArrayBuffer);
        expect(Array.from(out)).toEqual(Array.from(imprint));
      }),
      { numRuns: 100 },
    );
  });
});
