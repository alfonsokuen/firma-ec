/**
 * boundedDecode.test.ts — la guarda central del diff de "firma por lotes"
 * (`decodeStreamBounded`) no tenía NI UN test: el corpus real solo la
 * ejercitaba en la dirección "cabe", nunca en "se pasa" (mutación #1 de la
 * ronda de revisión: `return bytes;` sin tope sobrevivía toda la suite).
 * Estos tests cubren, con streams `PDFRawStream` reales (comprimidos y sin
 * comprimir, vía `PDFContext.flateStream`/`stream`, sin pasar por un
 * `PDFDocument` completo):
 *  - contenido dentro del presupuesto, decodificado byte a byte igual;
 *  - contenido que CRUZA el paso de la escalera (`STEP_BYTES`), para que la
 *    concatenación entre pasos se pruebe de verdad, no solo el caso de un
 *    único paso;
 *  - contenido que SUPERA el presupuesto: debe devolver `null`;
 *  - que la reserva de memoria interna crece sobre el tamaño REAL
 *    consumido, no sobre el techo declarado — el defecto medido por los dos
 *    revisores (16 MB reservados para 43 bytes reales).
 */
import { createRequire } from 'node:module';

import { PDFContext } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { decodeStreamBounded } from '../src/boundedDecode.js';

// Acceso a la clase interna `DecodeStream` de pdf-lib (no exportada
// públicamente) para instrumentar `ensureBuffer`: es EXACTAMENTE el método
// que `boundedDecode.ts` documenta como causante de la sobre-reserva (ver su
// cabecera), así que es el punto correcto para verificar desde fuera, sin
// acoplarse a los detalles internos de `decodeStreamBounded`.
const require = createRequire(import.meta.url);
const DecodeStreamClass = require('pdf-lib/cjs/core/streams/DecodeStream').default as {
  prototype: { ensureBuffer(requested: number): Uint8Array };
};

describe('decodeStreamBounded — dentro del presupuesto', () => {
  it('un stream SIN comprimir decodifica byte a byte idéntico al original', () => {
    const ctx = PDFContext.create();
    const original = new TextEncoder().encode('hola mundo');
    const stream = ctx.stream(original);

    const result = decodeStreamBounded(stream, 1024);

    expect(result).not.toBeNull();
    expect(Array.from(result!)).toEqual(Array.from(original));
  });

  it('un stream FlateDecode decodifica byte a byte idéntico al original', () => {
    const ctx = PDFContext.create();
    const original = new TextEncoder().encode(
      'el contenido real de un content stream de PDF'.repeat(3),
    );
    const stream = ctx.flateStream(original);

    const result = decodeStreamBounded(stream, original.length + 100);

    expect(result).not.toBeNull();
    expect(Array.from(result!)).toEqual(Array.from(original));
  });

  it('contenido que CRUZA varios pasos de la escalera (STEP_BYTES = 64 KiB) se concatena completo', () => {
    // Contenido muy compresible (para que 200 KB reales quepan cómodos en un
    // presupuesto razonable) pero MAYOR que un solo paso de 64 KiB, para que
    // la acumulación entre llamadas a `getBytes` se ejercite de verdad.
    const original = new Uint8Array(200 * 1024);
    for (let i = 0; i < original.length; i++) original[i] = i % 256;
    const ctx = PDFContext.create();
    const stream = ctx.flateStream(original);

    const result = decodeStreamBounded(stream, original.length + 1);

    expect(result).not.toBeNull();
    expect(result!.length).toBe(original.length);
    expect(Array.from(result!)).toEqual(Array.from(original));
  });

  it('el tope exacto (contenido === maxBytes) SÍ cabe', () => {
    const ctx = PDFContext.create();
    const original = new TextEncoder().encode('X'.repeat(70_000)); // cruza un paso de 64 KiB
    const stream = ctx.stream(original);

    const result = decodeStreamBounded(stream, original.length);

    expect(result).not.toBeNull();
    expect(result!.length).toBe(original.length);
  });
});

describe('decodeStreamBounded — se pasa del presupuesto (mutación #1: sin esto, "return bytes" sobrevive)', () => {
  it('un stream sin comprimir más grande que maxBytes devuelve null', () => {
    const ctx = PDFContext.create();
    const original = new TextEncoder().encode('X'.repeat(1000));
    const stream = ctx.stream(original);

    expect(decodeStreamBounded(stream, 500)).toBeNull();
  });

  it('un stream FlateDecode más grande que maxBytes devuelve null, cruzando varios pasos', () => {
    const ctx = PDFContext.create();
    const original = new Uint8Array(300 * 1024);
    for (let i = 0; i < original.length; i++) original[i] = (i * 7) % 256;
    const stream = ctx.flateStream(original);

    expect(decodeStreamBounded(stream, 100 * 1024)).toBeNull();
  });

  it('un byte de más (maxBytes + 1) también corta: el tope es estricto, no "aproximado"', () => {
    const ctx = PDFContext.create();
    const original = new TextEncoder().encode('Y'.repeat(101));
    const stream = ctx.stream(original);

    expect(decodeStreamBounded(stream, 100)).toBeNull();
  });
});

describe('decodeStreamBounded — la reserva crece con el contenido REAL, no con el techo (el hallazgo CRÍTICO)', () => {
  it('un stream comprimido de contenido diminuto NUNCA reserva un buffer del tamaño del techo', () => {
    // Los dos revisores midieron, con la implementación vieja
    // (`getBytes(maxBytes + 1)` de un tirón), que un stream de 43 bytes
    // reales con un techo de 8 MB reservaba `ensureBuffer` de 16.777.216
    // bytes (potencia de dos sobre el TECHO, antes de descomprimir nada).
    // Se instrumenta `DecodeStream.prototype.ensureBuffer` (compartido por
    // TODAS las instancias, incluida la que crea `decodeStreamBounded`
    // internamente) para capturar cada `requested` que ve durante una
    // llamada REAL a la función bajo prueba, y se afirma que ninguno se
    // acerca al techo: con la escalera, `requested` crece sobre lo YA
    // consumido (pasos de 64 KiB), nunca de un salto a `maxBytes`.
    const ctx = PDFContext.create();
    const tiny = new TextEncoder().encode('contenido real minusculo de 43 bytes exactos');
    expect(tiny.length).toBeLessThan(64);
    const stream = ctx.flateStream(tiny);

    const seenRequests: number[] = [];
    const originalEnsureBuffer = DecodeStreamClass.prototype.ensureBuffer;
    DecodeStreamClass.prototype.ensureBuffer = function patchedEnsureBuffer(
      this: unknown,
      requested: number,
    ) {
      seenRequests.push(requested);
      return originalEnsureBuffer.call(this, requested);
    };

    const maxBytes = 8 * 1024 * 1024; // el techo real de `MAX_CONTENT_BYTES_PER_PAGE`
    let result: Uint8Array | null;
    try {
      result = decodeStreamBounded(stream, maxBytes);
    } finally {
      DecodeStreamClass.prototype.ensureBuffer = originalEnsureBuffer;
    }

    expect(result).not.toBeNull();
    expect(result!.length).toBe(tiny.length);
    expect(seenRequests.length).toBeGreaterThan(0);
    // Ninguna petición de buffer se acercó al techo: el máximo visto debe
    // quedar en el orden de UN paso (64 KiB), muy por debajo de los 8 MB
    // (redondeados a 16 MB) que reservaba la implementación vieja.
    const maxRequested = Math.max(...seenRequests);
    const STEP_BYTES = 64 * 1024;
    expect(maxRequested).toBeLessThan(STEP_BYTES * 2);
    expect(maxRequested).toBeLessThan(maxBytes / 100);
  });
});
