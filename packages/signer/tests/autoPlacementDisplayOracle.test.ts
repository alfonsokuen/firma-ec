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

async function geometryFor(
  opts: { rotate?: number; cropBox?: number[]; pageSize?: [number, number] } = {},
) {
  const doc = await PDFDocument.create();
  const page = doc.addPage(opts.pageSize ?? [A4_W, A4_H]);
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

  /**
   * El punto ciego de este oráculo hasta 2026-07-30: el único caso de CropBox
   * que probaba era ANCHO (515×500), donde el cuadro de 240 pt entra de sobra.
   * El caso que rompe es el contrario — CropBox ESTRECHO Y DESPLAZADO, que es
   * lo que producen los tickets de 80 mm, los escaneos recortados y la
   * imposición: `computeDefaultFooterPlacement` no pasaba por `clampRect` y la
   * compuerta final solo comparaba contra el MediaBox, así que la estampa
   * salía del recorte (58 pt fuera, justo la banda del QR) y la validación
   * decía OK.
   *
   * Disparador medido: `visW < DEFAULT_SIG_BOX_W + 2·EDGE_MARGIN` (el cuadro
   * no cabe en el ancho visible) Y `visX ≥ (DEFAULT_SIG_BOX_W + 2·EDGE_MARGIN)
   * − visW` (el recorte está bastante desplazado como para que el rect siga
   * cayendo dentro del MediaBox y por eso la compuerta vieja lo dejaba pasar).
   */
  const NARROW_CROP_MEDIA: [number, number] = [612, 792];
  const NARROW_CROP_BOX = [300, 300, 500, 700];

  it('CropBox ESTRECHO y desplazado: nunca se firma fuera del área visible', async () => {
    const geometry = await geometryFor({
      pageSize: NARROW_CROP_MEDIA,
      cropBox: NARROW_CROP_BOX,
    });
    const g = geometry[0]!;
    expect([g.visX, g.visY, g.visW, g.visH]).toEqual([300, 300, 200, 400]);
    // Precondición del disparador: el cuadro por defecto NO cabe a lo ancho.
    expect(g.visW).toBeLessThan(DEFAULT_SIG_BOX_W + 2 * EDGE_MARGIN);
    // …y el recorte está lo bastante desplazado como para que un rect que se
    // sale del recorte siga cayendo DENTRO del MediaBox (por eso pasaba).
    expect(g.visX).toBeGreaterThanOrEqual(DEFAULT_SIG_BOX_W + 2 * EDGE_MARGIN - g.visW);

    const p = computeAutoPlacement({ geometry, existing: [] });

    // O se coloca dentro del área visible, o se aparta. Firmar fuera del
    // recorte y reportarlo como éxito no es una de las opciones.
    if (p.status === 'ok') {
      expect(p.x).toBeGreaterThanOrEqual(g.visX);
      expect(p.y).toBeGreaterThanOrEqual(g.visY);
      expect(p.x + p.w).toBeLessThanOrEqual(g.visX + g.visW);
      expect(p.y + p.h).toBeLessThanOrEqual(g.visY + g.visH);
    } else {
      expect(p.reason).toMatch(/outside_visible_area/);
    }
  });

  it('CropBox estrecho en las cuatro rotaciones: dentro del recorte o apartado', async () => {
    for (const rotate of [0, 90, 180, 270]) {
      const geometry = await geometryFor({
        pageSize: NARROW_CROP_MEDIA,
        cropBox: NARROW_CROP_BOX,
        rotate,
      });
      const g = geometry[0]!;
      const p = computeAutoPlacement({ geometry, existing: [] });
      if (p.status !== 'ok') {
        expect(p.reason, `rotate ${rotate}`).toMatch(/outside_visible_area|rect_too_small/);
        continue;
      }
      expect(p.x, `rotate ${rotate}`).toBeGreaterThanOrEqual(g.visX);
      expect(p.y, `rotate ${rotate}`).toBeGreaterThanOrEqual(g.visY);
      expect(p.x + p.w, `rotate ${rotate}`).toBeLessThanOrEqual(g.visX + g.visW);
      expect(p.y + p.h, `rotate ${rotate}`).toBeLessThanOrEqual(g.visY + g.visH);
    }
  });

  it('CropBox estrecho CON firma previa (rama anti-solape): igual de estricto', async () => {
    const geometry = await geometryFor({
      pageSize: NARROW_CROP_MEDIA,
      cropBox: NARROW_CROP_BOX,
    });
    const g = geometry[0]!;
    const p = computeAutoPlacement({
      geometry,
      existing: [{ page: 0, x: 310, y: 310, w: 160, h: 60 }],
    });
    if (p.status === 'ok') {
      expect(p.x).toBeGreaterThanOrEqual(g.visX);
      expect(p.y).toBeGreaterThanOrEqual(g.visY);
      expect(p.x + p.w).toBeLessThanOrEqual(g.visX + g.visW);
      expect(p.y + p.h).toBeLessThanOrEqual(g.visY + g.visH);
    }
  });

  it('CropBox estrecho CON campo de firma vacío declarado FUERA del recorte: se aparta', async () => {
    const geometry = await geometryFor({
      pageSize: NARROW_CROP_MEDIA,
      cropBox: NARROW_CROP_BOX,
    });
    // El documento declara el campo en una zona que el visor no muestra.
    const p = computeAutoPlacement({
      geometry,
      existing: [],
      emptySigFields: [{ page: 0, x: 20, y: 20, w: 160, h: 60 }],
    });
    expect(p.status).toBe('needs_review');
    if (p.status === 'needs_review') expect(p.reason).toMatch(/outside_visible_area/);
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
