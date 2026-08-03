/**
 * boundedDecode.ts — descomprime un stream de pdf-lib con un TECHO de bytes
 * de salida, sin inflar más de lo necesario para detectar que se pasó.
 *
 * `decodePDFRawStream(...).decode()` de pdf-lib no tiene techo: infla el
 * stream ENTERO en memoria antes de que el llamador pueda comparar contra su
 * propio presupuesto. Medido en `fontResources.ts`: una CMap `/ToUnicode` de
 * 40.778 bytes comprimidos generaba 41.943.040 bytes en memoria (ratio
 * 1029:1, cerca del peor caso teórico de DEFLATE) antes de que el módulo
 * llegara a mirar `MAX_TOUNICODE_BYTES`. El mismo defecto de forma vivía en
 * `textBands.ts` para el content stream de cada página.
 *
 * `.decode()` decodifica todo de una sola pasada; `.getBytes(n)`, de la
 * MISMA clase (`DecodeStream`/`Stream` en pdf-lib), avanza `pos` y devuelve
 * el SIGUIENTE tramo — llamadas sucesivas son un lector incremental, no una
 * relectura desde el principio.
 *
 * Pedir el techo entero de golpe (`getBytes(maxBytes + 1)`) seguía siendo un
 * defecto de FORMA aunque fuera una sola llamada: `ensureBuffer` (dentro de
 * `DecodeStream`) redondea `pos + length` a la siguiente potencia de dos Y
 * RESERVA ESE BUFFER *antes* de que `readBlock` haya descomprimido un solo
 * byte real. Con un techo de 8 MB (`textBands.ts`), CUALQUIER content stream
 * comprimido —así su contenido real midiera 43 bytes— reservaba y ponía a
 * cero 16.777.216 bytes. Medido: 32.768× más reserva que el contenido real, y
 * `readTextBands` sobre 17 documentos ×10 pasó de 285 ms (con `.decode()`,
 * sin tope) a 660 ms (2,3× más lento) — la mitigación de OOM introducía
 * presión de OOM.
 *
 * Por eso se lee en ESCALERA: se pide `STEP_BYTES` por vez y se acumula. Cada
 * `getBytes(STEP_BYTES)` solo hace crecer el buffer interno lo que hace falta
 * para cubrir lo consumido HASTA AHORA (potencia de dos sobre el tamaño REAL,
 * no sobre el techo teórico), y se corta en cuanto un paso devuelve menos de
 * lo pedido (EOF) o el acumulado supera `maxBytes` (bomba de tamaño).
 */
import { decodePDFRawStream, type PDFRawStream } from 'pdf-lib';

/**
 * Tamaño de cada paso de la escalera. Un content stream real cabe casi
 * siempre en un solo paso (`ensureBuffer` reserva ~64 KiB en vez del techo
 * completo); uno grande crece en pasos de 64 KiB en vez de un salto directo
 * a `maxBytes`.
 */
const STEP_BYTES = 64 * 1024;

/** Concatena los tramos acumulados. Con un solo tramo (el caso común) no copia nada. */
function concatChunks(chunks: readonly Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Descomprime `stream` hasta `maxBytes` de salida, en pasos de
 * {@link STEP_BYTES}. Si el contenido real decodificado supera `maxBytes`,
 * devuelve `null` sin haber acumulado más que `maxBytes + 1` bytes.
 *
 * Garantía real (y sus límites): la RESERVA de memoria crece sobre el
 * tamaño real consumido, nunca de golpe sobre el techo — eso es lo que
 * arregla esta función. Lo que NO arregla —y por eso no lo prometía nunca
 * de verdad, pese al comentario anterior— es el tamaño de un solo BLOQUE
 * deflate: `FlateStream.readBlock()` (heredado de pdf.js) descomprime un
 * bloque comprimido ENTERO en una sola pasada antes de devolver el control,
 * así que un paso de `STEP_BYTES` puede disparar la descompresión completa
 * de un bloque adversario mucho mayor que el paso pedido — medido: 650 KB
 * comprimidos → 103 MB inflados con un techo de 64 KB (1.575× lo que un
 * lector desprevenido asumiría). Cortar ESE caso exigiría interceptar
 * `readBlock` dentro de pdf-lib, no algo que se pueda hacer desde `getBytes`.
 * El contrato real de esta función es: "acota la reserva de memoria al
 * tamaño real de streams NO adversarios, y corta el recorrido en cuanto
 * termina el bloque deflate donde se cruza `maxBytes`" — no "nunca infla
 * más de `maxBytes + 1` bytes pase lo que pase en el stream".
 *
 * Puede lanzar (stream corrupto o filtro no soportado): el llamador decide
 * cómo degradar.
 */
export function decodeStreamBounded(stream: PDFRawStream, maxBytes: number): Uint8Array | null {
  const decoded = decodePDFRawStream(stream);
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    // Nunca se pide más de lo que hace falta para confirmar que se pasó: el
    // último paso se recorta a `maxBytes + 1 - total`, así el corte por
    // "superó el techo" sigue costando como mucho un byte de más, igual que
    // antes.
    const request = Math.min(STEP_BYTES, maxBytes + 1 - total);
    // `forceClamped` por defecto es `false`: en ese caso pdf-lib siempre
    // entrega `Uint8Array`, nunca `Uint8ClampedArray` (la unión de su tipo es
    // más ancha que su comportamiento real con los argumentos que usamos aquí).
    const block = decoded.getBytes(request) as Uint8Array;
    if (block.length > 0) {
      chunks.push(block);
      total += block.length;
    }
    if (total > maxBytes) return null;
    if (block.length < request) {
      // EOF: el stream real es más corto que lo pedido en este paso — se
      // devuelve lo acumulado, que es exactamente el contenido real.
      return concatChunks(chunks, total);
    }
  }
}
