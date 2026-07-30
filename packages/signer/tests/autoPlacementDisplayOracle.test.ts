/**
 * Oráculo INDEPENDIENTE de la colocación automática.
 *
 * Por qué existe aparte de `autoPlacement.test.ts`: este fichero no comprueba
 * coordenadas concretas contra las que produjo la implementación, sino la
 * propiedad FÍSICA que el usuario percibe — que el cuadro de firma queda junto
 * al borde inferior **tal como se ve en pantalla**, en las cuatro rotaciones.
 * Sus asserts se derivan de la definición de `/Rotate` (giro HORARIO al
 * mostrar, PDF 32000-1 §7.7.3.3), no del código: si alguien "arregla" un
 * assert de la otra suite para que pase, este sigue fallando.
 *
 * Derivación: el giro horario de 90° mapea (x,y) → (y,−x). De ahí, qué borde
 * del espacio de usuario acaba siendo el inferior en pantalla:
 *   /Rotate 0   → borde inferior (y mín)
 *   /Rotate 90  → borde DERECHO   (x máx)
 *   /Rotate 180 → borde SUPERIOR  (y máx)
 *   /Rotate 270 → borde IZQUIERDO (x mín)
 *
 * El defecto que motivó todo esto (medido antes del arreglo): nadie leía
 * `/Rotate` ni `/CropBox`, así que en una página rotada la estampa caía en el
 * borde equivocado y de lado, y con un CropBox menor que el MediaBox quedaba
 * FUERA del área que el visor muestra — firma presente, visualmente ausente.
 */
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIG_BOX_H,
  DEFAULT_SIG_BOX_W,
  EDGE_MARGIN,
  computeAutoPlacement,
} from '../src/autoPlacement.js';
import { readPageGeometry } from '../src/pageGeometry.js';

const A4_W = 595.28;
const A4_H = 841.89;

async function geometryFor(opts: { rotate?: number; cropBox?: number[] } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([A4_W, A4_H]);
  const ctx = page.node.context;
  if (opts.rotate !== undefined) page.node.set(ctx.obj('Rotate'), ctx.obj(opts.rotate));
  if (opts.cropBox) page.node.set(ctx.obj('CropBox'), ctx.obj(opts.cropBox));
  const reloaded = await PDFDocument.load(await doc.save());
  return readPageGeometry(reloaded);
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Vis {
  visX: number;
  visY: number;
  visW: number;
  visH: number;
  rotate: number;
}

/** Distancia del cuadro al borde inferior VISTO EN PANTALLA. */
function distFromDisplayedBottom(r: Box, g: Vis): number {
  switch (g.rotate) {
    case 90:
      return g.visX + g.visW - (r.x + r.w);
    case 180:
      return g.visY + g.visH - (r.y + r.h);
    case 270:
      return r.x - g.visX;
    default:
      return r.y - g.visY;
  }
}

/** Centro del cuadro sobre el eje HORIZONTAL de la pantalla, y el esperado. */
function displayedHorizontalCenter(r: Box, g: Vis): { got: number; want: number } {
  if (g.rotate === 90 || g.rotate === 270) {
    return { got: r.y + r.h / 2, want: g.visY + g.visH / 2 };
  }
  return { got: r.x + r.w / 2, want: g.visX + g.visW / 2 };
}

describe('oráculo: el cuadro cae al pie de la página TAL COMO SE MUESTRA', () => {
  for (const rotate of [0, 90, 180, 270]) {
    it(`/Rotate ${rotate}: pegado al borde inferior visto, y centrado`, async () => {
      const geometry = await geometryFor({ rotate });
      expect(geometry[0]!.rotate).toBe(rotate);

      const p = computeAutoPlacement({ geometry, existing: [] });
      expect(p.status).toBe('ok');
      if (p.status !== 'ok') return;

      // Dims intercambiadas en 90/270: el lado largo del cuadro corre vertical.
      const swapped = rotate === 90 || rotate === 270;
      expect(p.w).toBeCloseTo(swapped ? DEFAULT_SIG_BOX_H : DEFAULT_SIG_BOX_W, 1);
      expect(p.h).toBeCloseTo(swapped ? DEFAULT_SIG_BOX_W : DEFAULT_SIG_BOX_H, 1);

      // La apariencia tiene que compensar el giro de la página.
      expect(p.rotate).toBe(rotate);

      expect(distFromDisplayedBottom(p, geometry[0]!)).toBeCloseTo(EDGE_MARGIN, 0);

      const c = displayedHorizontalCenter(p, geometry[0]!);
      expect(c.got).toBeCloseTo(c.want, 0);
    });
  }

  it('CropBox recortado: el cuadro queda DENTRO del área visible', async () => {
    const geometry = await geometryFor({ cropBox: [40, 300, 555, 800] });
    const g = geometry[0]!;
    expect([g.visX, g.visY, g.visW, g.visH]).toEqual([40, 300, 515, 500]);

    const p = computeAutoPlacement({ geometry, existing: [] });
    expect(p.status).toBe('ok');
    if (p.status !== 'ok') return;

    expect(p.x).toBeGreaterThanOrEqual(g.visX);
    expect(p.y).toBeGreaterThanOrEqual(g.visY);
    expect(p.x + p.w).toBeLessThanOrEqual(g.visX + g.visW);
    expect(p.y + p.h).toBeLessThanOrEqual(g.visY + g.visH);
    // Y además sigue pasando la validación 0-based contra MediaBox.
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.x + p.w).toBeLessThanOrEqual(g.mediaW);
    expect(p.y + p.h).toBeLessThanOrEqual(g.mediaH);
  });

  it('/Rotate negativo se normaliza (−90 → 270)', async () => {
    const geometry = await geometryFor({ rotate: -90 });
    expect(geometry[0]!.rotate).toBe(270);
  });

  it('determinista: dos llamadas idénticas dan el mismo resultado', async () => {
    const geometry = await geometryFor({ rotate: 90 });
    expect(computeAutoPlacement({ geometry, existing: [] })).toEqual(
      computeAutoPlacement({ geometry, existing: [] }),
    );
  });
});
