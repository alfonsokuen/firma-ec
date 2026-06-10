/**
 * Regression: multi-firma sobre PDFs con object streams (/ObjStm).
 *
 * Bug 2026-06-09: PDFs cuya estructura (p.ej. el nodo /Pages) vive dentro de
 * object streams comprimidos — típico de iText e impresoras PDF modernas —
 * hacían fallar `addIncrementalSignature` con
 * `cannot_add_signature_to_corrupt_pdf` ("Pages object body not found"),
 * porque `parsePriorPdf`/`readObjectBody` solo veían objetos top-level en el
 * texto crudo y no descomprimían /ObjStm. El PDF NO estaba corrupto.
 *
 * Fix: pdf-lib (que ya se cargaba en el flujo) se usa como resolver de
 * fallback para objetos comprimidos.
 *
 * Fixture `objstm-signed.pdf`: base PyMuPDF guardada con `use_objstms` (el
 * nodo /Pages queda dentro de un /ObjStm) + 1 firma PAdES incremental real
 * (pyHanko) con el cert de test `rsa2048-valid.p12` — misma forma estructural
 * que un PDF firmado por iText (caso real: escrito legal multi-firmante).
 */

import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import * as pkijs from 'pkijs';
import { beforeAll, describe, expect, it } from 'vitest';

import { detectSignatures } from '../src/detectExistingSignatures.js';
import { addIncrementalSignature } from '../src/incrementalUpdate.js';
import { parsePfx } from '../src/p12.js';

beforeAll(() => {
  pkijs.setEngine(
    'node-webcrypto',
    new pkijs.CryptoEngine({ name: 'node-webcrypto', crypto: webcrypto as unknown as Crypto }),
  );
  if (!(globalThis as { crypto?: Crypto }).crypto) {
    (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;
  }
});

const FIX_DIR = join(__dirname, 'fixtures');
const PIN = 'test1234';

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIX_DIR, name)));
}

type IncArgs = Parameters<typeof addIncrementalSignature>;

describe('multi-firma sobre PDF con object streams (iText-style)', () => {
  it('fixture sanity: tiene /ObjStm, 1 firma previa, y /Pages NO es top-level', async () => {
    const pdf = loadFixture('objstm-signed.pdf');
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text).toContain('/ObjStm');

    const found = await detectSignatures(pdf);
    expect(found).toHaveLength(1);

    // El nodo /Pages debe estar comprimido (la condición que disparaba el bug).
    const catalogBodyMatch = text.match(/\/Pages\s+(\d+)\s+(\d+)\s+R/);
    expect(catalogBodyMatch).not.toBeNull();
    const pagesObjNum = Number(catalogBodyMatch![1]);
    const topLevel = new RegExp(`\\b${pagesObjNum}\\s+0\\s+obj\\b`).test(text);
    expect(topLevel).toBe(false);
  });

  it('añade una 2ª firma sin lanzar cannot_add_signature_to_corrupt_pdf', async () => {
    const pdf = loadFixture('objstm-signed.pdf');
    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);

    const out = await addIncrementalSignature(pdf, pfx as IncArgs[1], {
      reason: 'regression objstm',
    });

    // Prefijo byte-idéntico: la firma previa queda intacta.
    expect(out.length).toBeGreaterThan(pdf.length);
    expect(Buffer.from(out.subarray(0, pdf.length)).equals(Buffer.from(pdf))).toBe(true);

    // Ahora hay 2 firmas detectables.
    const found = await detectSignatures(out);
    expect(found).toHaveLength(2);

    // La salida sigue siendo un PDF parseable (pdf-lib la carga y ve las páginas).
    const reloaded = await PDFDocument.load(out, { updateMetadata: false });
    expect(reloaded.getPageCount()).toBe(2);
  });

  it('firma visible en página 2 (página comprimida) también funciona', async () => {
    const pdf = loadFixture('objstm-signed.pdf');
    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);

    const out = await addIncrementalSignature(pdf, pfx as IncArgs[1], {
      reason: 'visible objstm',
      visibleSig: { page: 1, x: 50, y: 50, width: 200, height: 60 },
    });

    expect(Buffer.from(out.subarray(0, pdf.length)).equals(Buffer.from(pdf))).toBe(true);
    const found = await detectSignatures(out);
    expect(found).toHaveLength(2);
  });
});
