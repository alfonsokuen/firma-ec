/**
 * textAdvance.ts — cuanto AVANZA horizontalmente una operacion de texto.
 *
 * El recorredor de `textBands.ts` sabe donde EMPIEZA cada linea (sale gratis de
 * la matriz de texto) pero nunca supo donde termina: no avanza `tm` tras un
 * `Tj`/`TJ` y las bandas ocupan el ancho visible completo por construccion. Sin
 * el borde derecho no se puede centrar la estampa sobre el nombre del firmante,
 * solo apoyarla en su margen izquierdo.
 *
 * Aqui vive esa cuenta, y SOLO esa: ISO 32000-1 §9.4.4 (avance de glifo),
 * §9.3.1-§9.3.4 (Tc, Tw, Tz). Se mantiene como funcion pura —fuera del
 * recorredor— porque es la pieza que hay que poder afirmar contra numeros
 * conocidos ("AAAA" en Helvetica 10 pt mide 26,68 pt) sin montar un PDF.
 *
 * Privacidad: entran bytes de codigo y salen puntos. Ni un caracter se
 * decodifica ni se guarda.
 */

import type { FontWidths } from './fontWidths.js';

/** Una pieza de una operacion de texto, en el orden en que aparece. */
export type AdvanceOperand =
  | { kind: 'string'; bytes: Uint8Array }
  /** Desplazamiento numerico dentro de un array `TJ`, en milesimas de em. */
  | { kind: 'adjust'; value: number };

/** Parametros de estado de texto que entran en el avance (ISO 32000-1 §9.3). */
export interface TextAdvanceState {
  /** Tamano de fuente vigente (`Tf`). */
  fontSize: number;
  /** `Tc`, en unidades de espacio de texto sin escalar. */
  charSpacing: number;
  /** `Tw`, idem. Solo aplica al byte 32 de una fuente de UN byte. */
  wordSpacing: number;
  /** `Tz` ya dividido por 100 (1 = 100%). */
  horizScale: number;
}

/** Codigo del espacio: el unico byte al que `Tw` afecta (ISO 32000-1 §9.3.3). */
const SPACE_CODE = 32;

/**
 * Avance de UNA cadena, en unidades de espacio de texto (los mismos puntos que
 * usa la matriz de texto), o `null` si algun codigo no tiene ancho conocido.
 *
 * `null` no es "cero": es "no se sabe". Devolver un avance corto donde falta un
 * glifo pondria el borde derecho a la izquierda del real y la estampa saldria
 * descentrada hacia la izquierda sin que nada avisara — mas vale no opinar.
 */
export function stringAdvance(
  bytes: Uint8Array,
  widths: FontWidths,
  state: TextAdvanceState,
): number | null {
  const step = widths.codeLength;
  // Una Type0 con longitud impar no esta codificada en 2 bytes por codigo: la
  // CMap no es Identity-H y medirla asi daria un numero inventado.
  if (step === 2 && bytes.length % 2 !== 0) return null;

  let total = 0;
  for (let i = 0; i + step <= bytes.length; i += step) {
    const code = step === 2 ? (bytes[i]! << 8) | bytes[i + 1]! : bytes[i]!;
    const w = widths.widthOf(code);
    if (w === null || !Number.isFinite(w)) return null;
    // `Tw` solo se aplica al byte simple 32; en una fuente de 2 bytes el
    // codigo 32 NO es un espacio (ISO 32000-1 §9.3.3).
    const word = step === 1 && code === SPACE_CODE ? state.wordSpacing : 0;
    total += (w / 1000) * state.fontSize + state.charSpacing + word;
  }
  return total;
}

/**
 * Avance total de una operacion de texto (`Tj`, `TJ`, `'`, `"`), ya escalado
 * por `Tz`, en las unidades de la matriz de texto. `null` si alguna cadena no
 * se pudo medir.
 *
 * Los desplazamientos de `TJ` van en milesimas de em y RESTAN (un valor
 * positivo mueve el texto hacia la izquierda, ISO 32000-1 §9.4.3).
 */
export function advanceOfOperands(
  operands: readonly AdvanceOperand[],
  widths: FontWidths,
  state: TextAdvanceState,
): number | null {
  if (!Number.isFinite(state.fontSize) || !Number.isFinite(state.horizScale)) return null;
  let total = 0;
  for (const op of operands) {
    if (op.kind === 'adjust') {
      if (!Number.isFinite(op.value)) return null;
      total -= (op.value / 1000) * state.fontSize;
      continue;
    }
    const adv = stringAdvance(op.bytes, widths, state);
    if (adv === null) return null;
    total += adv;
  }
  const scaled = total * state.horizScale;
  return Number.isFinite(scaled) ? scaled : null;
}
