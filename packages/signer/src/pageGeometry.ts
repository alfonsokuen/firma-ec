/**
 * pageGeometry.ts — lee la geometría REAL de cada página de un PDF: `/MediaBox`,
 * `/CropBox` (intersectado con `/MediaBox`, en coordenadas absolutas) y
 * `/Rotate` normalizado, resolviendo herencia del árbol `/Pages`.
 *
 * Por qué existe: hoy nadie en el proyecto lee `/Rotate` ni `/CropBox` — la PWA
 * asume implícitamente MediaBox = área visible y rotate = 0. Con un PDF rotado
 * o con CropBox más chico que MediaBox eso coloca la estampa mal (D1) o fuera
 * del área que el visor muestra (D2). Ver `_probe-rotate.mjs` (medición) y la
 * spec §1-2 para la derivación completa.
 *
 * Módulo puro: no toca red, disco ni reloj — solo lee el `PDFDocument` en
 * memoria que el caller ya cargó.
 */

import type { PDFDocument } from 'pdf-lib';

/** Geometría resuelta de una página, en coordenadas PDF absolutas (pt). */
export interface PageGeometry {
  /** Índice de página, 0-based. */
  page: number;
  /** Ancho/alto de `/MediaBox` — lo que valida `validateVisibleSig` hoy. */
  mediaW: number;
  mediaH: number;
  /** Origen de `/MediaBox` (normalmente 0,0, pero no siempre). */
  mediaX: number;
  mediaY: number;
  /** `/CropBox` ∩ `/MediaBox`, en coordenadas absolutas — el área que el
   * visor realmente muestra. Si no hay `/CropBox` válido, = MediaBox. */
  visX: number;
  visY: number;
  visW: number;
  visH: number;
  /** `/Rotate` normalizado a [0, 360) y a un múltiplo de 90. */
  rotate: 0 | 90 | 180 | 270;
}

const VALID_ROTATIONS = new Set([0, 90, 180, 270]);

/**
 * Normaliza `/Rotate`: colapsa negativos y múltiplos de 360 al rango [0,360),
 * y trata cualquier valor que no sea múltiplo de 90 (PDF corrupto o inválido)
 * como 0 en vez de reventar — spec §2 nota "no reinventes esto".
 */
export function normalizeRotate(deg: number): 0 | 90 | 180 | 270 {
  if (!Number.isFinite(deg)) return 0;
  const mod = ((Math.round(deg) % 360) + 360) % 360;
  return (VALID_ROTATIONS.has(mod) ? mod : 0) as 0 | 90 | 180 | 270;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Intersección de dos rects axis-aligned. `null` si no se solapan. */
function intersectRects(a: Rect, b: Rect): Rect | null {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * Lee la geometría de todas las páginas de `pdfDoc`.
 *
 * Herencia: `getMediaBox`/`getCropBox`/`getRotation` de pdf-lib SÍ resuelven
 * `/MediaBox`, `/CropBox` y `/Rotate` heredados del árbol `/Pages` cuando el
 * nodo hoja no define su propia clave (verificado con test dedicado — ver
 * `pageGeometry.test.ts`, caso "hereda del nodo Pages padre"). No hace falta
 * caminar `/Parent` a mano.
 *
 * `/CropBox` degenerado, invertido (ancho/alto ≤ 0 tras normalizar) o
 * disjunto de `/MediaBox` cae a MediaBox — nunca revienta.
 */
export function readPageGeometry(pdfDoc: PDFDocument): PageGeometry[] {
  return pdfDoc.getPages().map((page, index) => {
    const media = page.getMediaBox();
    const mediaRect: Rect = { x: media.x, y: media.y, w: media.width, h: media.height };

    let visRect: Rect = mediaRect;
    let crop: ReturnType<typeof page.getCropBox> | undefined;
    try {
      crop = page.getCropBox();
    } catch {
      // Algunos PDFs corruptos tienen un /CropBox ilegible — degradar a
      // MediaBox en vez de reventar la lectura de geometría del documento.
      crop = undefined;
    }
    if (
      crop &&
      Number.isFinite(crop.x) &&
      Number.isFinite(crop.y) &&
      Number.isFinite(crop.width) &&
      Number.isFinite(crop.height) &&
      crop.width > 0 &&
      crop.height > 0
    ) {
      const cropRect: Rect = { x: crop.x, y: crop.y, w: crop.width, h: crop.height };
      const intersection = intersectRects(mediaRect, cropRect);
      if (intersection) visRect = intersection;
      // Disjunto o degenerado tras intersectar: se queda con visRect = MediaBox.
    }

    const rotate = normalizeRotate(page.getRotation().angle);

    return {
      page: index,
      mediaW: mediaRect.w,
      mediaH: mediaRect.h,
      mediaX: mediaRect.x,
      mediaY: mediaRect.y,
      visX: visRect.x,
      visY: visRect.y,
      visW: visRect.w,
      visH: visRect.h,
      rotate,
    };
  });
}
