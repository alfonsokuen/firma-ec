/**
 * Tests for autoPlacement.ts — colocación automática de la firma visible
 * para el flujo de lotes (spec §4, criterios observables).
 *
 * Criterio 1 reemplaza a la sonda `_probe-rotate.mjs` (borrada tras esta
 * medición): reproduce los 5 casos de la tabla §1 con el camino REAL
 * (pdf.js da dims igual que hace PdfPreview, pdf-lib valida igual que
 * validateVisibleSig) y compara explícitamente contra el cálculo VIEJO
 * (`placeBottomCenter`, tal como hacía `placeAtBottomLastPage` sin leer
 * `/Rotate`/`/CropBox`) para dejar constancia del rojo que existía antes.
 */
import { PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SIG_BOX_H,
  DEFAULT_SIG_BOX_W,
  EDGE_MARGIN,
  type ExistingSigRect,
  computeAutoPlacement,
} from '../src/autoPlacement.js';
import { readPageGeometry } from '../src/pageGeometry.js';

// ── Réplica del defecto D1/D2 (comportamiento PRE-fix), tal como lo midió
// `_probe-rotate.mjs`: usa las dims de pdf.js (que intercambia w/h con
// /Rotate 90/270 y NO conoce /CropBox) para centrar al pie de página. ──────
function placeBottomCenterBuggy(dim: { w: number; h: number }) {
  return {
    x: Math.min(
      Math.max((dim.w - DEFAULT_SIG_BOX_W) / 2, EDGE_MARGIN),
      dim.w - EDGE_MARGIN - DEFAULT_SIG_BOX_W,
    ),
    y: EDGE_MARGIN,
    w: DEFAULT_SIG_BOX_W,
    h: DEFAULT_SIG_BOX_H,
  };
}

const A4_W = 595.28;
const A4_H = 841.89;

async function makePdf({
  rotate = 0,
  cropBox,
}: { rotate?: number; cropBox?: [number, number, number, number] } = {}): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([A4_W, A4_H]);
  if (rotate) page.node.set(PDFName.of('Rotate'), doc.context.obj(rotate));
  if (cropBox) page.node.set(PDFName.of('CropBox'), doc.context.obj(cropBox));
  return doc;
}

/** Simula lo que hoy calcula pdf.js: dims intercambiadas si /Rotate es 90/270. */
function pdfJsDims(mediaW: number, mediaH: number, rotate: number): { w: number; h: number } {
  return rotate === 90 || rotate === 270 ? { w: mediaH, h: mediaW } : { w: mediaW, h: mediaH };
}

describe('criterio 1 — los 5 casos medidos por la sonda quedan dentro del área visible y en el tercio inferior EN PANTALLA', () => {
  const cases: Array<{
    name: string;
    opts: { rotate?: number; cropBox?: [number, number, number, number] };
  }> = [
    { name: 'normal (control)', opts: {} },
    { name: '/Rotate 90', opts: { rotate: 90 } },
    { name: '/Rotate 270', opts: { rotate: 270 } },
    { name: '/Rotate 180', opts: { rotate: 180 } },
    { name: 'CropBox < MediaBox', opts: { cropBox: [40, 300, 555, 800] } },
  ];

  for (const c of cases) {
    it(`${c.name}: el cálculo VIEJO fallaba, computeAutoPlacement no`, async () => {
      const doc = await makePdf(c.opts);
      const [geo] = readPageGeometry(doc);
      expect(geo).toBeDefined();

      // ── Rojo: el cálculo viejo (dims de pdf.js, sin CropBox) ──
      const buggyDims = pdfJsDims(geo!.mediaW, geo!.mediaH, c.opts.rotate ?? 0);
      const buggyRect = placeBottomCenterBuggy(buggyDims);
      const buggyInsideVisible =
        buggyRect.x >= geo!.visX &&
        buggyRect.y >= geo!.visY &&
        buggyRect.x + buggyRect.w <= geo!.visX + geo!.visW &&
        buggyRect.y + buggyRect.h <= geo!.visY + geo!.visH;

      // ── Rojo, según el defecto REAL medido por la sonda (spec §1 tabla) ──
      // D2 (CropBox): el rect viejo cae GEOMÉTRICAMENTE fuera del área visible.
      if (c.opts.cropBox) {
        expect(buggyInsideVisible).toBe(false);
      }
      // D1 (/Rotate 90/270/180): el rect viejo SÍ cae dentro del MediaBox
      // (por eso "validateVisibleSig PASA" en la tabla — no revienta), pero
      // queda anclado siempre al MISMO borde (y = EDGE_MARGIN, "abajo" en
      // espacio de usuario SIN rotar) sin importar `/Rotate` — exactamente
      // "el borde equivocado" que describe la spec §1. El cálculo correcto,
      // en cambio, ancla cada rotación a un borde DISTINTO (tabla §2).
      if (c.opts.rotate === 90 || c.opts.rotate === 270 || c.opts.rotate === 180) {
        expect(buggyRect.y).toBeCloseTo(EDGE_MARGIN, 5); // el viejo SIEMPRE ancla aquí
      }

      // ── Verde: computeAutoPlacement ──
      const placement = computeAutoPlacement({ geometry: [geo!], existing: [] });
      expect(placement.status).toBe('ok');
      if (placement.status !== 'ok') return;

      // Dentro del área visible.
      expect(placement.x).toBeGreaterThanOrEqual(geo!.visX - 1e-6);
      expect(placement.y).toBeGreaterThanOrEqual(geo!.visY - 1e-6);
      expect(placement.x + placement.w).toBeLessThanOrEqual(geo!.visX + geo!.visW + 1e-6);
      expect(placement.y + placement.h).toBeLessThanOrEqual(geo!.visY + geo!.visH + 1e-6);

      // "Tercio inferior EN PANTALLA": transforma el rect resultante por la
      // rotación (como lo vería el visor) y comprueba que su centro cae en
      // el tercio inferior de la altura orientada.
      const rotate = geo!.rotate;
      const oriented =
        rotate === 90 || rotate === 270
          ? { w: geo!.visH, h: geo!.visW }
          : { w: geo!.visW, h: geo!.visH };
      // Distancia del centro del rect al borde de anclaje (el que es "abajo"
      // en pantalla), en el eje que la rotación convierte en verticalidad.
      let distFromScreenBottom: number;
      if (rotate === 0) distFromScreenBottom = placement.y + placement.h / 2 - geo!.visY;
      else if (rotate === 180)
        distFromScreenBottom = geo!.visY + geo!.visH - (placement.y + placement.h / 2);
      else if (rotate === 90)
        distFromScreenBottom = geo!.visX + geo!.visW - (placement.x + placement.w / 2);
      else distFromScreenBottom = placement.x + placement.w / 2 - geo!.visX;

      expect(distFromScreenBottom).toBeLessThanOrEqual(oriented.h / 3);
      expect(distFromScreenBottom).toBeGreaterThanOrEqual(0);
    });
  }
});

describe('criterio 3 — CropBox recortado: el rect queda dentro de CropBox', () => {
  it('página con CropBox más chico que MediaBox', async () => {
    const doc = await makePdf({ cropBox: [40, 300, 555, 800] });
    const geo = readPageGeometry(doc);
    const placement = computeAutoPlacement({ geometry: geo, existing: [] });
    expect(placement.status).toBe('ok');
    if (placement.status !== 'ok') return;
    expect(placement.x).toBeGreaterThanOrEqual(40);
    expect(placement.y).toBeGreaterThanOrEqual(300);
    expect(placement.x + placement.w).toBeLessThanOrEqual(555);
    expect(placement.y + placement.h).toBeLessThanOrEqual(800);
  });
});

describe('criterio 5 — campo de firma vacío: se respeta su rect y no se recoloca', () => {
  it('con un emptySigField declarado, ignora anti-solape y footer', async () => {
    const doc = await makePdf();
    const geo = readPageGeometry(doc);
    const fieldRect = { page: 0, x: 100, y: 500, w: 150, h: 40 };
    const placement = computeAutoPlacement({
      geometry: geo,
      existing: [{ page: 0, x: 10, y: 10, w: 240, h: 72 }],
      emptySigFields: [fieldRect],
    });
    expect(placement).toMatchObject({
      status: 'ok',
      page: 0,
      x: 100,
      y: 500,
      w: 150,
      h: 40,
      source: 'empty-field',
    });
  });

  it('con varios campos vacíos, elige el primero en orden de página', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([A4_W, A4_H]);
    doc.addPage([A4_W, A4_H]);
    const geo = readPageGeometry(doc);
    const placement = computeAutoPlacement({
      geometry: geo,
      existing: [],
      emptySigFields: [
        { page: 1, x: 5, y: 5, w: 50, h: 20 },
        { page: 0, x: 20, y: 20, w: 60, h: 30 },
      ],
    });
    expect(placement).toMatchObject({ status: 'ok', page: 0, x: 20, y: 20 });
  });
});

describe('criterio 6 — firma previa visible: no hay solape (holgura ≥ GAP/2)', () => {
  it('coloca la nueva firma sin solapar la existente', async () => {
    const doc = await makePdf();
    const geo = readPageGeometry(doc);
    const existing: ExistingSigRect[] = [{ page: 0, x: 18, y: 18, w: 240, h: 72 }];
    const placement = computeAutoPlacement({ geometry: geo, existing });
    expect(placement.status).toBe('ok');
    if (placement.status !== 'ok') return;
    expect(placement.source).toBe('anti-overlap');
    const noOverlap =
      placement.x + placement.w + 6.9 <= existing[0]!.x ||
      existing[0]!.x + existing[0]!.w + 6.9 <= placement.x ||
      placement.y + placement.h + 6.9 <= existing[0]!.y ||
      existing[0]!.y + existing[0]!.h + 6.9 <= placement.y;
    expect(noOverlap).toBe(true);
  });

  it('anti-solape también respeta el área visible con página rotada', async () => {
    const doc = await makePdf({ rotate: 90 });
    const geo = readPageGeometry(doc);
    const existing: ExistingSigRect[] = [
      { page: 0, x: geo[0]!.visX + 18, y: geo[0]!.visY + 300, w: 240, h: 72 },
    ];
    const placement = computeAutoPlacement({ geometry: geo, existing });
    expect(placement.status).toBe('ok');
    if (placement.status !== 'ok') return;
    expect(placement.x).toBeGreaterThanOrEqual(geo[0]!.visX - 1e-6);
    expect(placement.y).toBeGreaterThanOrEqual(geo[0]!.visY - 1e-6);
    expect(placement.x + placement.w).toBeLessThanOrEqual(geo[0]!.visX + geo[0]!.visW + 1e-6);
    expect(placement.y + placement.h).toBeLessThanOrEqual(geo[0]!.visY + geo[0]!.visH + 1e-6);
  });
});

describe('criterio 7 — MediaBox con origen ≠ (0,0) → needs_review, sin excepción ni rect inválido', () => {
  it('no lanza y devuelve needs_review con motivo', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    // Offset grande a propósito: con un offset pequeño, `x+w <= mediaW`
    // (mediaW = ANCHO, no el borde x2) puede seguir cumpliéndose por
    // casualidad — ver la nota en `autoPlacement.ts` sobre por qué esta
    // comprobación asume origen (0,0). Este offset garantiza que no.
    page.node.set(PDFName.of('MediaBox'), doc.context.obj([500, 500, 1095, 1342]));
    const geo = readPageGeometry(doc);
    expect(() => computeAutoPlacement({ geometry: geo, existing: [] })).not.toThrow();
    const placement = computeAutoPlacement({ geometry: geo, existing: [] });
    expect(placement.status).toBe('needs_review');
    if (placement.status === 'needs_review') {
      expect(typeof placement.reason).toBe('string');
      expect(placement.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('criterio 8 — determinismo: misma entrada → misma salida', () => {
  it('dos llamadas idénticas devuelven exactamente lo mismo', async () => {
    const doc = await makePdf({ rotate: 180 });
    const geo = readPageGeometry(doc);
    const opts = {
      geometry: geo,
      existing: [{ page: 0, x: 20, y: 20, w: 100, h: 40 }],
    };
    const a = computeAutoPlacement(opts);
    const b = computeAutoPlacement(opts);
    expect(a).toEqual(b);
  });
});

describe('fuente 3 — pie de la última página cuando no hay campos vacíos ni firmas previas', () => {
  it('página normal: centrado horizontal, borde inferior a EDGE_MARGIN', async () => {
    const doc = await makePdf();
    const geo = readPageGeometry(doc);
    const placement = computeAutoPlacement({ geometry: geo, existing: [] });
    expect(placement.status).toBe('ok');
    if (placement.status !== 'ok') return;
    expect(placement.source).toBe('default-footer');
    expect(placement.y).toBeCloseTo(EDGE_MARGIN, 5);
    expect(placement.w).toBe(DEFAULT_SIG_BOX_W);
    expect(placement.h).toBe(DEFAULT_SIG_BOX_H);
    expect(placement.rotate).toBe(0);
  });

  it('/Rotate 90: ancla al borde derecho, dims físicas h×w, y centrado', async () => {
    const doc = await makePdf({ rotate: 90 });
    const geo = readPageGeometry(doc);
    const placement = computeAutoPlacement({ geometry: geo, existing: [] });
    expect(placement.status).toBe('ok');
    if (placement.status !== 'ok') return;
    expect(placement.rotate).toBe(90);
    expect(placement.w).toBeCloseTo(DEFAULT_SIG_BOX_H, 5); // dims físicas: h×w
    expect(placement.h).toBeCloseTo(DEFAULT_SIG_BOX_W, 5);
    expect(placement.x + placement.w).toBeCloseTo(A4_W - EDGE_MARGIN, 5);
  });

  it('/Rotate 270: ancla al borde izquierdo', async () => {
    const doc = await makePdf({ rotate: 270 });
    const geo = readPageGeometry(doc);
    const placement = computeAutoPlacement({ geometry: geo, existing: [] });
    expect(placement.status).toBe('ok');
    if (placement.status !== 'ok') return;
    expect(placement.rotate).toBe(270);
    expect(placement.x).toBeCloseTo(EDGE_MARGIN, 5);
  });

  it('/Rotate 180: ancla al borde superior', async () => {
    const doc = await makePdf({ rotate: 180 });
    const geo = readPageGeometry(doc);
    const placement = computeAutoPlacement({ geometry: geo, existing: [] });
    expect(placement.status).toBe('ok');
    if (placement.status !== 'ok') return;
    expect(placement.rotate).toBe(180);
    expect(placement.y + placement.h).toBeCloseTo(A4_H - EDGE_MARGIN, 5);
  });
});
