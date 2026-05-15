import { describe, expect, it } from 'vitest';
import { serializeStreamObject, serializeStreams } from '../src/streams';

describe('streams', () => {
  it('serializes a single stream object with /Length matching DER size', () => {
    const der = new Uint8Array([0x30, 0x82, 0x01, 0x02, 0x03, 0x04]);
    const out = serializeStreamObject(7, 0, der);
    const txt = new TextDecoder('latin1').decode(out);
    expect(txt).toMatch(/^7 0 obj\n<< \/Length 6 >>\nstream\n/);
    expect(txt).toContain('\nendstream\nendobj\n');
  });

  it('preserves DER bytes verbatim in the stream body', () => {
    const der = new Uint8Array([0, 0x0a, 0x0d, 0x25, 0xff, 0x1b]); // includes newlines and `%`
    const out = serializeStreamObject(10, 0, der);
    // Find the 'stream\n' marker and the closing '\nendstream'.
    const txt = new TextDecoder('latin1').decode(out);
    const streamStart = txt.indexOf('stream\n') + 'stream\n'.length;
    const endstreamStart = txt.indexOf('\nendstream');
    expect(out.slice(streamStart, endstreamStart)).toEqual(der);
  });

  it('rejects invalid object numbers', () => {
    expect(() => serializeStreamObject(0, 0, new Uint8Array(1))).toThrow();
    expect(() => serializeStreamObject(-1, 0, new Uint8Array(1))).toThrow();
  });

  it('serializes an array of streams with sequential object numbers + offsets', () => {
    const a = new Uint8Array(10);
    const b = new Uint8Array(20);
    const c = new Uint8Array(5);
    const res = serializeStreams([a, b, c], 100, 5000);
    expect(res.objNums).toEqual([100, 101, 102]);
    // Each offset should be base + (cumulative length of prior).
    expect(res.offsets[0]).toBe(5000);
    expect(res.offsets[1]).toBe(5000 + serializeStreamObject(100, 0, a).length);
    expect(res.offsets[2]).toBe(
      5000 + serializeStreamObject(100, 0, a).length + serializeStreamObject(101, 0, b).length,
    );
    // Total bytes length matches sum of parts.
    const totalExpected =
      serializeStreamObject(100, 0, a).length +
      serializeStreamObject(101, 0, b).length +
      serializeStreamObject(102, 0, c).length;
    expect(res.bytes.length).toBe(totalExpected);
  });

  it('handles empty input array', () => {
    const res = serializeStreams([], 50, 1000);
    expect(res.objNums).toEqual([]);
    expect(res.offsets).toEqual([]);
    expect(res.bytes.length).toBe(0);
  });
});
