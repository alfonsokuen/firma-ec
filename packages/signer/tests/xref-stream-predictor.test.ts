/**
 * Regression: multi-firma sobre PDFs cuyo xref es un STREAM con PNG predictor
 * (`/DecodeParms << /Columns N /Predictor 12 >>`) — el formato que escriben
 * Adobe Acrobat y cualquier productor con FlateDecode+predictor (qpdf/pikepdf,
 * MuPDF).
 *
 * Bug 2026-06-25 (caso real: un PDF firmado en Adobe Acrobat, con un xref
 * stream comprimido + predictor): `addIncrementalSignature` abortaba con
 * `cannot_add_signature_to_corrupt_pdf` → "cross-reference ... is neither a
 * classical xref table nor a /Type /XRef stream". El PDF NO estaba corrupto.
 *
 * Causa raíz: `parseXrefStreamDict` cerraba el dict con `indexOf('>>')`, que
 * para en el `>>` del sub-dict `/DecodeParms`, truncando el dict del xref. Si
 * `/DecodeParms` va antes de `/Type /XRef` (Adobe) → "neither ... /Type /XRef";
 * si va antes de `/Root`/`/Size` (qpdf/pikepdf) → "/Size missing". Fix: escaneo
 * balanceado de `<<`/`>>`.
 *
 * Segundo bug del mismo PDF: el campo de firma de Adobe (`/T (Signature2)`)
 * vive comprimido en un object stream, así que el scan textual de nombres no lo
 * veía y el nuevo campo se nombraba también `Signature2` → colisión `/T` (los
 * visores deduplican por nombre y descartan una firma). Fix: enumerar campos
 * vía pdf-lib + `pickSignatureFieldName` que salta nombres existentes.
 */

import { describe, expect, it } from 'vitest';
import { parseXrefStreamDict, pickSignatureFieldName } from '../src/incrementalUpdate.js';

/** Envuelve un dict interno en un objeto xref-stream a un offset dado. */
function xrefStreamAt(dictInner: string, offset = 5): { text: string; off: number } {
  const obj = `88 0 obj\r<<${dictInner}>>\nstream\nBINARYxx\nendstream\nendobj\n`;
  return { text: 'PRE\r\n'.padEnd(offset, ' ') + obj, off: offset };
}

describe('parseXrefStreamDict: xref streams con DecodeParms/predictor anidado', () => {
  it('orden Adobe: /DecodeParms ANTES de /Type /XRef (caso real Acrobat)', () => {
    const { text, off } = xrefStreamAt(
      '/DecodeParms<</Columns 5/Predictor 12>>/Filter/FlateDecode' +
        '/ID[<A1B2><C3D4>]/Index[0 1 88 3]/Info 5 0 R/Length 200/Prev 116' +
        '/Root 69 0 R/Size 90/Type/XRef/W[1 3 1]',
    );
    const r = parseXrefStreamDict(text, off);
    expect(r).toEqual({ size: 90, rootObj: 69, rootGen: 0 });
  });

  it('orden qpdf/pikepdf: /Root y /Size DESPUÉS del sub-dict /DecodeParms', () => {
    const { text, off } = xrefStreamAt(
      ' /Type /XRef /Length 34 /Filter /FlateDecode' +
        ' /DecodeParms << /Columns 4 /Predictor 12 >> /W [ 1 2 1 ] /Root 2 0 R /Size 7 ',
    );
    const r = parseXrefStreamDict(text, off);
    expect(r).toEqual({ size: 7, rootObj: 2, rootGen: 0 });
  });

  it('sin DecodeParms (no regresión): sigue parseando', () => {
    const { text, off } = xrefStreamAt('/Type/XRef/Size 5/Root 1 0 R/W[1 2 1]');
    const r = parseXrefStreamDict(text, off);
    expect(r).toEqual({ size: 5, rootObj: 1, rootGen: 0 });
  });

  it('no es un xref stream → lanza (el caller cae al parser de tabla clásica)', () => {
    const { text, off } = xrefStreamAt('/Type/ObjStm/N 3/First 20/Length 40');
    expect(() => parseXrefStreamDict(text, off)).toThrow(/neither a classical xref table/);
  });
});

describe('pickSignatureFieldName: evita colisión de /T', () => {
  it('sin campos previos visibles → Signature2 (priorCount=1)', () => {
    expect(pickSignatureFieldName(new Set(), 1)).toBe('Signature2');
  });

  it('campo Adobe comprimido "Signature2" presente → salta a Signature3', () => {
    expect(pickSignatureFieldName(new Set(['Signature2']), 1)).toBe('Signature3');
  });

  it('salta múltiples nombres ocupados', () => {
    expect(pickSignatureFieldName(new Set(['Signature2', 'Signature3']), 1)).toBe('Signature4');
  });
});
