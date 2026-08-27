/**
 * standardFontWidths.ts — anchos de glifo de las fuentes estandar de PDF, esas
 * para las que el documento NO incrusta un array `/Widths`.
 *
 * ISO 32000-1 §9.6.2.2 permite omitir `/Widths` en las 14 fuentes estandar: el
 * lector debe conocer sus metricas de memoria. Sin esta tabla, un bloque de
 * firma escrito en Helvetica —lo que emite cualquier generador minimo, y lo que
 * usan los fixtures— no tiene ni un ancho de glifo disponible y el estimador de
 * fin de linea no puede opinar sobre donde TERMINA la linea.
 *
 * PROCEDENCIA: extraidas de los AFM de Adobe que vendoriza
 * `@pdf-lib/standard-fonts@1.0.0` (Core 14 AFM Metrics, con su licencia de
 * Adobe dentro de ese paquete), cruzando `CharMetrics[].N` con los nombres de
 * glifo de su tabla `win1252` (WinAnsiEncoding). Se generaron UNA vez y se
 * congelan aqui como dato: leerlas en caliente obligaria a inflar y parsear
 * ~200 KB de JSON comprimido por documento para consultar veinte numeros.
 *
 * Rango: codigos 32..255 de WinAnsiEncoding. Un `0` significa "ese codigo no
 * tiene glifo en esta codificacion", no "ancho cero" — quien consulta lo trata
 * como desconocido y cae al `/MissingWidth` del documento.
 *
 * Courier va aparte: es de paso fijo, 600 para todo codigo, y no gasta tabla.
 */

/** Primer codigo cubierto por cada fila de {@link STANDARD_WIDTH_ROWS}. */
export const STANDARD_FIRST_CODE = 32;

/** Ancho de cualquier glifo de Courier (fuente de paso fijo). */
export const COURIER_WIDTH = 600;

/**
 * Anchos en milesimas de em (la unidad de `/Widths`), codigos 32..255,
 * separados por espacios. Se guardan como cadena y se parsean bajo demanda: una
 * tabla que la mayoria de documentos no consulta —casi todos incrustan sus
 * `/Widths`— no merece ocho arrays vivos en cada import.
 */
const STANDARD_WIDTH_ROWS: Readonly<Record<string, string>> = {
  Helvetica:
    '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 ' +
    '556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 ' +
    '556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 ' +
    '556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 ' +
    '500 500 500 334 260 334 584 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ' +
    '0 0 278 333 556 556 556 556 260 556 333 737 370 556 584 333 737 333 400 584 333 333 333 ' +
    '556 537 278 333 333 365 556 834 834 834 611 667 667 667 667 667 667 1000 722 667 667 667 ' +
    '667 278 278 278 278 722 722 778 778 778 778 778 584 778 722 722 722 722 667 667 611 556 ' +
    '556 556 556 556 556 889 500 556 556 556 556 278 278 278 278 556 556 556 556 556 556 556 ' +
    '584 611 556 556 556 556 500 556 500',
  'Helvetica-Bold':
    '278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 ' +
    '556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 ' +
    '611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 ' +
    '611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 ' +
    '556 556 500 389 280 389 584 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ' +
    '0 0 278 333 556 556 556 556 280 556 333 737 370 556 584 333 737 333 400 584 333 333 333 ' +
    '611 556 278 333 333 365 556 834 834 834 611 722 722 722 722 722 722 1000 722 667 667 667 ' +
    '667 278 278 278 278 722 722 778 778 778 778 778 584 778 722 722 722 722 667 667 611 556 ' +
    '556 556 556 556 556 889 556 556 556 556 556 278 278 278 278 611 611 611 611 611 611 611 ' +
    '584 611 611 611 611 611 556 611 556',
  'Helvetica-Oblique':
    '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 ' +
    '556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 ' +
    '556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 ' +
    '556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 ' +
    '500 500 500 334 260 334 584 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ' +
    '0 0 278 333 556 556 556 556 260 556 333 737 370 556 584 333 737 333 400 584 333 333 333 ' +
    '556 537 278 333 333 365 556 834 834 834 611 667 667 667 667 667 667 1000 722 667 667 667 ' +
    '667 278 278 278 278 722 722 778 778 778 778 778 584 778 722 722 722 722 667 667 611 556 ' +
    '556 556 556 556 556 889 500 556 556 556 556 278 278 278 278 556 556 556 556 556 556 556 ' +
    '584 611 556 556 556 556 500 556 500',
  'Helvetica-BoldOblique':
    '278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 ' +
    '556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 ' +
    '611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 ' +
    '611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 ' +
    '556 556 500 389 280 389 584 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ' +
    '0 0 278 333 556 556 556 556 280 556 333 737 370 556 584 333 737 333 400 584 333 333 333 ' +
    '611 556 278 333 333 365 556 834 834 834 611 722 722 722 722 722 722 1000 722 667 667 667 ' +
    '667 278 278 278 278 722 722 778 778 778 778 778 584 778 722 722 722 722 667 667 611 556 ' +
    '556 556 556 556 556 889 556 556 556 556 556 278 278 278 278 611 611 611 611 611 611 611 ' +
    '584 611 611 611 611 611 556 611 556',
  'Times-Roman':
    '250 333 408 500 500 833 778 180 333 333 500 564 250 333 250 278 500 500 500 500 500 500 ' +
    '500 500 500 500 278 278 564 564 564 444 921 722 667 667 722 611 556 722 722 333 389 722 ' +
    '611 889 722 722 556 722 667 556 611 722 722 944 722 722 611 333 278 333 469 500 333 444 ' +
    '500 444 500 444 333 500 500 278 278 500 278 778 500 500 500 500 333 389 278 500 500 722 ' +
    '500 500 444 480 200 480 541 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ' +
    '0 0 250 333 500 500 500 500 200 500 333 760 276 500 564 333 760 333 400 564 300 300 333 ' +
    '500 453 250 333 300 310 500 750 750 750 444 722 722 722 722 722 722 889 667 611 611 611 ' +
    '611 333 333 333 333 722 722 722 722 722 722 722 564 722 722 722 722 722 722 556 500 444 ' +
    '444 444 444 444 444 667 444 444 444 444 444 278 278 278 278 500 500 500 500 500 500 500 ' +
    '564 500 500 500 500 500 500 500 500',
  'Times-Bold':
    '250 333 555 500 500 1000 833 278 333 333 500 570 250 333 250 278 500 500 500 500 500 500 ' +
    '500 500 500 500 333 333 570 570 570 500 930 722 667 722 722 667 611 778 778 389 500 778 ' +
    '667 944 722 778 611 778 722 556 667 722 722 1000 722 722 667 333 278 333 581 500 333 500 ' +
    '556 444 556 444 333 500 556 278 333 556 278 833 556 500 556 556 444 389 333 556 500 722 ' +
    '500 500 444 394 220 394 520 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ' +
    '0 0 250 333 500 500 500 500 220 500 333 747 300 500 570 333 747 333 400 570 300 300 333 ' +
    '556 540 250 333 300 330 500 750 750 750 500 722 722 722 722 722 722 1000 722 667 667 667 ' +
    '667 389 389 389 389 722 722 778 778 778 778 778 570 778 722 722 722 722 722 611 556 500 ' +
    '500 500 500 500 500 722 444 444 444 444 444 278 278 278 278 500 556 500 500 500 500 500 ' +
    '570 500 556 556 556 556 500 556 500',
  'Times-Italic':
    '250 333 420 500 500 833 778 214 333 333 500 675 250 333 250 278 500 500 500 500 500 500 ' +
    '500 500 500 500 333 333 675 675 675 500 920 611 611 667 722 611 611 722 722 333 444 667 ' +
    '556 833 667 722 611 722 611 500 556 722 611 833 611 556 556 389 278 389 422 500 333 500 ' +
    '500 444 500 444 278 500 500 278 278 444 278 722 500 500 500 500 389 389 278 500 444 667 ' +
    '444 444 389 400 275 400 541 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ' +
    '0 0 250 389 500 500 500 500 275 500 333 760 276 500 675 333 760 333 400 675 300 300 333 ' +
    '500 523 250 333 300 310 500 750 750 750 500 611 611 611 611 611 611 889 667 611 611 611 ' +
    '611 333 333 333 333 722 667 722 722 722 722 722 675 722 722 722 722 722 556 611 500 500 ' +
    '500 500 500 500 500 667 444 444 444 444 444 278 278 278 278 500 500 500 500 500 500 500 ' +
    '675 500 500 500 500 500 444 500 444',
  'Times-BoldItalic':
    '250 389 555 500 500 833 778 278 333 333 500 570 250 333 250 278 500 500 500 500 500 500 ' +
    '500 500 500 500 333 333 570 570 570 500 832 667 667 667 722 667 667 722 778 389 500 667 ' +
    '611 889 722 722 611 722 667 556 611 722 667 889 667 611 611 333 278 333 570 500 333 500 ' +
    '500 444 500 444 333 500 556 278 278 500 278 778 556 500 500 500 389 389 278 556 444 667 ' +
    '500 444 389 348 220 348 570 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ' +
    '0 0 250 389 500 500 500 500 220 500 333 747 266 500 606 333 747 333 400 570 300 300 333 ' +
    '576 500 250 333 300 300 500 750 750 750 500 667 667 667 667 667 667 944 667 667 667 667 ' +
    '667 389 389 389 389 722 722 722 722 722 722 722 570 722 722 722 722 722 611 611 500 500 ' +
    '500 500 500 500 500 722 444 444 444 444 444 278 278 278 278 500 556 500 500 500 500 500 ' +
    '570 500 556 556 556 556 444 500 444',
};

const parsed = new Map<string, readonly number[]>();

function rowFor(key: string): readonly number[] | null {
  const cached = parsed.get(key);
  if (cached) return cached;
  const raw = STANDARD_WIDTH_ROWS[key];
  if (raw === undefined) return null;
  const widths = raw.split(' ').map(Number);
  parsed.set(key, widths);
  return widths;
}

/**
 * Familias METRICAMENTE COMPATIBLES con las estandar de Adobe: mismo ancho de
 * avance glifo a glifo, no solo "parecidas a la vista".
 *
 * La lista es corta A PROPOSITO. Antes entraban aqui Verdana, Tahoma, Calibri,
 * Segoe, Georgia y Cambria "porque son sans o serif", y ninguna comparte
 * metricas: medido sobre la misma cadena, Verdana sale un 12% mas ANCHA que
 * Helvetica y Georgia un 15% mas ancha que Times. Un ancho a un 12% de
 * distancia no es una aproximacion util para centrar una estampa — es un
 * numero inventado con aspecto de medida. Sin `/Widths` propio, esas fuentes
 * se quedan sin ancho y el estimador calla, que es la respuesta honesta.
 *
 * Los clones libres (Liberation, Nimbus) SI estan porque se disenaron
 * expresamente con las metricas de las estandar, y son lo que emite
 * LibreOffice en Linux sin incrustar el `/Widths`.
 */
const FAMILIAS: ReadonlyArray<{ patron: RegExp; base: 'Helvetica' | 'Times' | 'Courier' }> = [
  { patron: /^(couriernew|courier|liberationmono|nimbusmono)/, base: 'Courier' },
  { patron: /^(timesnewroman|times|liberationserif|nimbusroman|nimbusromno)/, base: 'Times' },
  { patron: /^(helvetica|arialmt|arial|liberationsans|nimbussans)/, base: 'Helvetica' },
];

/**
 * Variantes que comparten el NOMBRE de familia pero no sus metricas. Arial
 * Narrow mide ~82% de Arial y Arial Black es bastante mas ancha que
 * Helvetica-Bold: aceptarlas por empezar con "arial" era exactamente el error
 * que {@link FAMILIAS} evita en las demas.
 */
const VARIANTES_INCOMPATIBLES = /narrow|condensed|black|heavy|light|thin|semi|extra|ultra/;

/**
 * Normaliza un `/BaseFont` a la clave de la tabla, o `null` si esa fuente no es
 * ninguna de las estandar (ni un clon metricamente compatible).
 *
 * Tolera el prefijo de subconjunto (`ABCDEF+Helvetica`) y los sufijos de estilo
 * de PostScript (`Arial-BoldMT`, `TimesNewRomanPSMT`). No adivina mas alla de
 * eso: el estimador prefiere no opinar a inventar un borde derecho.
 */
export function standardFontKey(baseFont: string): string | null {
  const sinSubset = baseFont.replace(/^[A-Z]{6}\+/, '');
  const lower = sinSubset.replace(/[\s_-]/g, '').toLowerCase();
  if (VARIANTES_INCOMPATIBLES.test(lower)) return null;
  const familia = FAMILIAS.find((f) => f.patron.test(lower));
  if (!familia) return null;
  if (familia.base === 'Courier') return 'Courier';

  const bold = /bold/.test(lower);
  const italic = /italic|oblique/.test(lower);
  if (familia.base === 'Times') {
    if (bold && italic) return 'Times-BoldItalic';
    if (bold) return 'Times-Bold';
    if (italic) return 'Times-Italic';
    return 'Times-Roman';
  }
  if (bold && italic) return 'Helvetica-BoldOblique';
  if (bold) return 'Helvetica-Bold';
  if (italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

/**
 * Ancho, en milesimas de em, del codigo `code` en la fuente estandar `key`, o
 * `null` cuando no se conoce (codigo fuera del rango 32..255, o sin glifo en
 * WinAnsiEncoding).
 */
export function standardWidth(key: string, code: number): number | null {
  if (key === 'Courier') return COURIER_WIDTH;
  const row = rowFor(key);
  if (!row) return null;
  const w = row[code - STANDARD_FIRST_CODE];
  return w === undefined || w === 0 ? null : w;
}
