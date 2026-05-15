import { describe, expect, it } from 'vitest';
import { serializeDssDict } from '../src/dictionary';
import type { VriEntry } from '../src/index';

describe('dictionary', () => {
  it('serializes DSS dict with /Type /DSS + indirect refs for /Certs, /OCSPs, /CRLs', () => {
    const out = serializeDssDict(50, {
      certObjNums: [10, 11],
      ocspObjNums: [12],
      crlObjNums: [13],
      vri: {},
    });
    const txt = new TextDecoder('latin1').decode(out);
    expect(txt).toMatch(/^50 0 obj\n/);
    expect(txt).toContain('/Type /DSS');
    expect(txt).toContain('/Certs [10 0 R 11 0 R]');
    expect(txt).toContain('/OCSPs [12 0 R]');
    expect(txt).toContain('/CRLs [13 0 R]');
    expect(txt).toContain('endobj');
  });

  it('emits empty arrays as `[]`', () => {
    const out = serializeDssDict(1, {
      certObjNums: [],
      ocspObjNums: [],
      crlObjNums: [],
      vri: {},
    });
    const txt = new TextDecoder('latin1').decode(out);
    expect(txt).toContain('/Certs []');
    expect(txt).toContain('/OCSPs []');
    expect(txt).toContain('/CRLs []');
    expect(txt).not.toContain('/VRI');
  });

  it('includes /VRI sub-dict with hex-keyed entries resolving to obj nums', () => {
    const vri: Record<string, VriEntry> = {
      DEADBEEF: { certIndices: [0, 1], ocspIndices: [0], crlIndices: [] },
    };
    const out = serializeDssDict(50, {
      certObjNums: [10, 11],
      ocspObjNums: [12],
      crlObjNums: [],
      vri,
    });
    const txt = new TextDecoder('latin1').decode(out);
    expect(txt).toContain('/VRI');
    expect(txt).toContain('/DEADBEEF');
    expect(txt).toContain('/Cert [10 0 R 11 0 R]');
    expect(txt).toContain('/OCSP [12 0 R]');
  });

  it('encodes /TS reference when timestampTokenIndex present', () => {
    const out = serializeDssDict(50, {
      certObjNums: [10],
      ocspObjNums: [12, 13],
      crlObjNums: [],
      vri: {
        AABB: {
          certIndices: [0],
          ocspIndices: [0],
          crlIndices: [],
          timestampTokenIndex: 1,
        },
      },
    });
    const txt = new TextDecoder('latin1').decode(out);
    expect(txt).toContain('/TS 13 0 R');
  });
});
