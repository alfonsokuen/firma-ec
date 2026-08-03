/**
 * Defectos del DEFAULT de producto de la firma por lotes (estampa visible
 * automática, sin humano por documento). Los tres que se fijan aquí viven en
 * `incrementalUpdate.ts` — la ruta multifirma — y ninguno se ve firmando un
 * solo documento a mano:
 *
 *   A1 · La página destino se resolvía con un regex sobre el `/Kids` de primer
 *        nivel del nodo raíz `/Pages`, asumiendo árbol PLANO. Con un árbol
 *        anidado (Acrobat y las herramientas de fusión los producen)
 *        `pageRefs` contenía los NODOS INTERMEDIOS, no las páginas: pedir
 *        `page:5` en un documento de 6 páginas caía fuera de rango y la firma
 *        se escribía INVISIBLE (`/Rect [0 0 0 0]`) reportándose como éxito, y
 *        pedir `page:0` colgaba el widget de un nodo `/Pages` — que no se
 *        renderiza en ninguna página — con un `/Rect` no nulo que miente.
 *
 *   A3 · La rotación se ignoraba: la ruta de firma única intercambia el BBox y
 *        escribe `/Matrix` (visibleSig.ts), la incremental fijaba
 *        `[0 0 width height]` sin swap y sin `/Matrix`, así que con
 *        `/Rotate 90` el bloque de texto arrancaba en el borde de un BBox de 72
 *        pt de ancho y se recortaba entero.
 *
 *   A5 · El truncado del CN era por NÚMERO DE CARACTERES, no por ancho: un CN
 *        real de 35 caracteres mide más que el hueco disponible y el BBox lo
 *        recortaba a mitad de palabra, sin error y sin elipsis.
 *
 * El oráculo de A1 es `analyzePdfForPlacement` — independiente de
 * `incrementalUpdate.ts`: recorre las páginas REALES con pdf-lib y devuelve el
 * rect de cada firma ya puesta. Si la estampa no aparece ahí, no está en
 * ninguna página que un visor muestre.
 *
 * Ningún test preexistente se modifica: este fichero es nuevo.
 */

import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  type PDFRef,
  StandardFontEmbedder,
} from 'pdf-lib';
import * as pkijs from 'pkijs';
import { beforeAll, describe, expect, it } from 'vitest';

import { analyzePdfForPlacement } from '../src/analyzePdf.js';
import { SignerError } from '../src/errors.js';
import { addIncrementalSignature } from '../src/incrementalUpdate.js';
import { parsePfx } from '../src/p12.js';
import { signPdfPades } from '../src/pades.js';

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

type Pfx = Parameters<typeof signPdfPades>[1];

function loadPfx(): Promise<Pfx> {
  return parsePfx(
    new Uint8Array(readFileSync(join(FIX_DIR, 'rsa2048-valid.p12'))),
    PIN,
  ) as Promise<unknown> as Promise<Pfx>;
}

/**
 * CN real de 35 caracteres medido por la auditoría. Con el layout de lote
 * (240×72, QR a la izquierda) el hueco de texto son 162 pt y esta línea mide
 * 223,2 pt a 8 pt de Helvetica: el truncado por caracteres no lo ve.
 */
const LONG_CN = 'ZAMBRANO CEDENO MARIA DE LOS ANGELE';

/** Sustituye el CN del firmante sin tocar la clave ni el certificado (solo es metadato de la estampa). */
function withSignerCN(pfx: Pfx, cn: string): Pfx {
  const p = pfx as unknown as { signingCert: { subjectCN: string } };
  return { ...(pfx as object), signingCert: { ...p.signingCert, subjectCN: cn } } as Pfx;
}

const PAGE_W = 400;
const PAGE_H = 300;

/**
 * PDF de `pageCount` páginas cuyo árbol `/Pages` tiene DOS niveles: la raíz
 * cuelga de dos nodos `/Pages` intermedios, y las páginas cuelgan de esos. Es
 * exactamente lo que produce una fusión de documentos, y lo que el regex plano
 * no sabía leer.
 */
async function buildNestedPageTreePdf(pageCount = 6): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) doc.addPage([PAGE_W, PAGE_H]);

  const ctx = doc.context;
  const rootRef = doc.catalog.get(PDFName.of('Pages')) as PDFRef;
  const rootNode = ctx.lookup(rootRef, PDFDict);
  const kids = rootNode.lookup(PDFName.of('Kids'), PDFArray);

  const pageRefs: PDFRef[] = [];
  for (let i = 0; i < kids.size(); i += 1) pageRefs.push(kids.get(i) as PDFRef);

  const half = Math.ceil(pageRefs.length / 2);
  const groups = [pageRefs.slice(0, half), pageRefs.slice(half)];
  const midRefs = groups.map((group) => {
    const midRef = ctx.nextRef();
    ctx.assign(
      midRef,
      ctx.obj({ Type: 'Pages', Parent: rootRef, Count: group.length, Kids: group }),
    );
    for (const ref of group) ctx.lookup(ref, PDFDict).set(PDFName.of('Parent'), midRef);
    return midRef;
  });

  rootNode.set(PDFName.of('Kids'), ctx.obj(midRefs));
  rootNode.set(PDFName.of('Count'), ctx.obj(pageCount));

  return doc.save({ useObjectStreams: false });
}

/** Firma una vez (invisible) para dejar el documento listo para la ruta incremental. */
async function signOnce(pdf: Uint8Array, pfx: Pfx): Promise<Uint8Array> {
  const r = await signPdfPades(pdf, pfx, { timestamp: false, ltv: { profile: 'B-B' } });
  return r.signedPdf;
}

const STAMP_W = 240;
const STAMP_H = 72;

describe('A1 — árbol /Pages anidado: la estampa tiene que caer en una PÁGINA real', () => {
  it('page:5 de 6 en dos nodos intermedios: la firma queda VISIBLE en la página 5', async () => {
    const pfx = await loadPfx();
    const signed = await signOnce(await buildNestedPageTreePdf(6), pfx);

    const out = await addIncrementalSignature(signed, pfx as never, {
      timestamp: false,
      ltv: { profile: 'B-B' },
      visibleSig: {
        page: 5,
        x: 80,
        y: 40,
        width: STAMP_W,
        height: STAMP_H,
        signerCN: 'Test Signer RSA-2048',
      },
    });

    // Oráculo independiente: recorre las páginas reales y devuelve los rects.
    const analysis = await analyzePdfForPlacement(out);
    expect(analysis.geometry).toHaveLength(6);
    const onPage5 = analysis.existing.filter((r) => r.page === 5);
    expect(onPage5).toHaveLength(1);
    expect(onPage5[0]!.w).toBeCloseTo(STAMP_W, 3);
    expect(onPage5[0]!.h).toBeCloseTo(STAMP_H, 3);
  });

  it('page:0: el widget cuelga de una PÁGINA, nunca de un nodo /Pages', async () => {
    const pfx = await loadPfx();
    const signed = await signOnce(await buildNestedPageTreePdf(6), pfx);

    const out = await addIncrementalSignature(signed, pfx as never, {
      timestamp: false,
      ltv: { profile: 'B-B' },
      visibleSig: {
        page: 0,
        x: 80,
        y: 40,
        width: STAMP_W,
        height: STAMP_H,
        signerCN: 'Test Signer RSA-2048',
      },
    });

    const analysis = await analyzePdfForPlacement(out);
    const onPage0 = analysis.existing.filter((r) => r.page === 0);
    expect(onPage0).toHaveLength(1);

    // Y el /P del widget nuevo apunta a un objeto /Type /Page.
    const doc = await PDFDocument.load(out, { throwOnInvalidObject: false, updateMetadata: false });
    const annots = doc.getPages()[0]!.node.lookup(PDFName.of('Annots'), PDFArray);
    let widgetsWithPageParent = 0;
    for (let i = 0; i < annots.size(); i += 1) {
      const widget = annots.lookup(i, PDFDict);
      const p = widget.lookup(PDFName.of('P'));
      if (p instanceof PDFDict) {
        const type = p.lookup(PDFName.of('Type'));
        expect(type instanceof PDFName ? type.asString() : '').toBe('/Page');
        widgetsWithPageParent += 1;
      }
    }
    expect(widgetsWithPageParent).toBeGreaterThan(0);
  });

  it('estampa visible pedida en una página inexistente: FALLA, no degrada a rect nulo', async () => {
    const pfx = await loadPfx();
    const signed = await signOnce(await buildNestedPageTreePdf(6), pfx);

    await expect(
      addIncrementalSignature(signed, pfx as never, {
        timestamp: false,
        ltv: { profile: 'B-B' },
        visibleSig: {
          page: 99,
          x: 10,
          y: 10,
          width: STAMP_W,
          height: STAMP_H,
          signerCN: 'Test Signer RSA-2048',
        },
      }),
    ).rejects.toThrow(SignerError);
  });
});

describe('A3 — la ruta incremental honra /Rotate como ya hace la ruta única', () => {
  it('rotate 90: BBox intercambiado + /Matrix, para que el texto no se recorte', async () => {
    const pfx = await loadPfx();
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE_W, PAGE_H]);
    page.node.set(PDFName.of('Rotate'), doc.context.obj(90));
    const signed = await signOnce(await doc.save({ useObjectStreams: false }), pfx);

    // Rect FÍSICO con las dimensiones intercambiadas — lo que emite
    // `computeAutoPlacement` para una página /Rotate 90.
    const out = await addIncrementalSignature(signed, pfx as never, {
      timestamp: false,
      ltv: { profile: 'B-B' },
      visibleSig: {
        page: 0,
        x: 18,
        y: 20,
        width: STAMP_H,
        height: STAMP_W,
        rotate: 90,
        signerCN: 'Test Signer RSA-2048',
      },
    });

    // Solo la parte AÑADIDA por la actualización incremental: el PDF base ya
    // trae /Matrix de sus propios XObjects y contaminaría el assert.
    const tail = new TextDecoder('latin1').decode(out).slice(signed.length);
    // La apariencia se dibuja SIN rotar: 240 de ancho × 72 de alto.
    expect(tail).toContain(`/BBox [0 0 ${STAMP_W} ${STAMP_H}]`);
    expect(tail).not.toContain(`/BBox [0 0 ${STAMP_H} ${STAMP_W}]`);
    // Y el giro va en /Matrix (misma tabla que visibleSig.ts).
    expect(tail).toContain('/Matrix [0 -1 1 0 0 0]');
  });

  it('rotate 0 (o ausente): BBox sin swap y SIN /Matrix — camino verde intacto', async () => {
    const pfx = await loadPfx();
    const doc = await PDFDocument.create();
    doc.addPage([PAGE_W, PAGE_H]);
    const signed = await signOnce(await doc.save({ useObjectStreams: false }), pfx);

    const out = await addIncrementalSignature(signed, pfx as never, {
      timestamp: false,
      ltv: { profile: 'B-B' },
      visibleSig: {
        page: 0,
        x: 18,
        y: 20,
        width: STAMP_W,
        height: STAMP_H,
        signerCN: 'Test Signer RSA-2048',
      },
    });

    const tail = new TextDecoder('latin1').decode(out).slice(signed.length);
    expect(tail).toContain(`/BBox [0 0 ${STAMP_W} ${STAMP_H}]`);
    expect(tail).not.toContain('/Matrix');
  });
});

/** Hueco de texto del layout de lote: BBox 240 − (padding + QR + padding) − padding. */
const BATCH_TEXT_WIDTH = 162;
/** Tamaño de fuente del bloque de texto en la ruta incremental. */
const INCREMENTAL_FONT_SIZE = 7;

/** Decodifica el primer `<hex> Tj` del PDF a texto Latin-1. */
function firstTjText(pdfText: string): string {
  const m = pdfText.match(/<([0-9a-fA-F]+)>\s*Tj/);
  if (!m) throw new Error('no se encontró ningún <hex> Tj en el PDF');
  const hex = m[1]!;
  let out = '';
  for (let i = 0; i < hex.length; i += 2)
    out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
  return out;
}

describe('A5 — el texto de la estampa se trunca MIDIENDO, no contando caracteres', () => {
  it('un CN real de 35 caracteres cabe en el hueco disponible de la ruta incremental', async () => {
    const pfx = await loadPfx();
    const doc = await PDFDocument.create();
    doc.addPage([PAGE_W, PAGE_H]);
    const signed = await signOnce(await doc.save({ useObjectStreams: false }), pfx);

    const out = await addIncrementalSignature(signed, withSignerCN(pfx, LONG_CN) as never, {
      timestamp: false,
      ltv: { profile: 'B-B' },
      visibleSig: {
        page: 0,
        x: 18,
        y: 20,
        width: STAMP_W,
        height: STAMP_H,
        signerCN: LONG_CN,
      },
    });

    const line = firstTjText(new TextDecoder('latin1').decode(out).slice(signed.length));
    expect(line.startsWith('Firmado por: ')).toBe(true);
    const helv = StandardFontEmbedder.for('Helvetica');
    expect(helv.widthOfTextAtSize(line, INCREMENTAL_FONT_SIZE)).toBeLessThanOrEqual(
      BATCH_TEXT_WIDTH,
    );
  });
});
