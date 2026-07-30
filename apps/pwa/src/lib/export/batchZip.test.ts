/**
 * batchZip — el ZIP se verifica con un EXTRACTOR AJENO (bsdtar en Windows,
 * `unzip` en Linux), nunca con nuestro propio lector.
 *
 * Que nuestro código lea nuestro ZIP no prueba nada: un bug simétrico en el
 * escritor y el lector (offsets del directorio central, endianness, CRC) pasa
 * verde en los dos lados y el usuario descubre el archivo corrupto cuando ya
 * borró los originales. El único testigo válido es una implementación que no
 * escribimos nosotros.
 */

import { describe, expect, it } from 'vitest';
import { buildMinimalPdf } from '../workers/minimalPdf.fixture';
import {
  BatchZipCapacityError,
  BatchZipWriter,
  MAX_ZIP_TOTAL_BYTES,
  assertBatchFitsZip,
  estimateSignedZipBytes,
} from './batchZip';
import { extractWithForeignTool, foreignExtractorName } from './foreignZipExtract.fixture';

function pdfOf(seed: number, extraBytes = 0): Uint8Array {
  const base = buildMinimalPdf([{ mediaBox: [0, 0, 595.28, 841.89] }]);
  if (extraBytes === 0) return base;
  // Relleno pseudoaleatorio: incompresible, así que un ZIP en modo "store"
  // tiene que devolver EXACTAMENTE estos bytes.
  const out = new Uint8Array(base.length + extraBytes);
  out.set(base, 0);
  let x = seed | 1;
  for (let i = base.length; i < out.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = (x >>> 16) & 0xff;
  }
  return out;
}

describe('el ZIP se abre y se extrae con una herramienta ajena', () => {
  it(`${foreignExtractorName} extrae los PDFs byte a byte idénticos`, async () => {
    const docs = [
      { name: 'contrato.pdf', bytes: pdfOf(7, 40_000) },
      { name: 'acta.pdf', bytes: pdfOf(11, 1_500) },
      { name: 'poder.pdf', bytes: pdfOf(13) },
    ];
    const writer = new BatchZipWriter();
    for (const d of docs) writer.addPdf(d.name, d.bytes);
    const zip = writer.finish();

    const extracted = await extractWithForeignTool(zip);

    expect([...extracted.keys()].sort()).toEqual([
      'acta-firmado.pdf',
      'contrato-firmado.pdf',
      'poder-firmado.pdf',
    ]);
    for (const d of docs) {
      const entryName = d.name.replace(/\.pdf$/, '-firmado.pdf');
      expect(extracted.get(entryName)).toEqual(d.bytes);
    }
  });

  it('mantiene los bytes aunque el llamante reutilice/borre su búfer tras entregarlo', async () => {
    // Con `onItemSigned` el llamante puede reciclar el búfer del documento
    // anterior. Si el escritor guardase la REFERENCIA en vez de copiar los
    // bytes fuera del heap, el ZIP saldría lleno de ceros y en verde.
    const original = pdfOf(23, 5_000);
    const handedOver = original.slice();
    const writer = new BatchZipWriter();
    writer.addPdf('reciclado.pdf', handedOver);
    handedOver.fill(0);
    const extracted = await extractWithForeignTool(writer.finish());
    expect(extracted.get('reciclado-firmado.pdf')).toEqual(original);
  });

  it('un lote vacío produce un ZIP válido y vacío', async () => {
    const zip = new BatchZipWriter().finish();
    const extracted = await extractWithForeignTool(zip);
    expect(extracted.size).toBe(0);
  });
});

/**
 * Cota del pico transitorio de arrays en el heap del escritor. Una cabecera
 * local de ZIP son ~30 bytes fijos + el nombre del fichero: decenas de bytes.
 * Si el escritor retuviera payload, este pico sería del orden de los kB/MB del
 * documento — por eso 256 discrimina acumulación de contabilidad normal.
 */
const MAX_TRANSIENT_HEAP_BYTES = 256;
/** Lo único que puede variar entre lotes: la longitud del nombre en la cabecera. */
const MAX_HEAP_DELTA_FROM_NAME_LENGTH_BYTES = 16;

describe('no acumula PDFs firmados en el heap', () => {
  it('deja CERO bytes de payload en arrays del heap, y no crece con el nº de documentos', () => {
    const shapeFor = (count: number) => {
      const writer = new BatchZipWriter();
      for (let i = 0; i < count; i++) writer.addPdf(`doc-${i}.pdf`, pdfOf(i + 1, 10_000));
      return writer.__debugBufferShapeForTests();
    };
    const few = shapeFor(3);
    const many = shapeFor(30);

    // El payload vive en almacenamiento de Blob (fuera del heap JS), nunca en
    // un array retenido por el escritor.
    expect(few.heapArrayBytes).toBe(0);
    expect(many.heapArrayBytes).toBe(0);
    // Lo único que crece son las cabeceras: decenas de bytes por entrada, no MB.
    expect(many.headerBytes / many.entries).toBeLessThan(200);
    // El pico transitorio NO escala con el nº de documentos. No se puede exigir
    // igualdad exacta porque la cabecera local incluye el NOMBRE del fichero, y
    // `doc-29.pdf` pesa un byte más que `doc-3.pdf`. Lo que delataría
    // acumulación es un pico del orden del payload (10 kB por documento aquí),
    // no una diferencia de bytes sueltos.
    expect(many.maxHeapArrayBytes).toBeLessThan(MAX_TRANSIENT_HEAP_BYTES);
    expect(many.maxHeapArrayBytes - few.maxHeapArrayBytes).toBeLessThan(
      MAX_HEAP_DELTA_FROM_NAME_LENGTH_BYTES,
    );
  });
});

describe('el tope se rechaza ANTES de firmar', () => {
  const oneGiB = 1024 * 1024 * 1024;

  it('MAX_ZIP_TOTAL_BYTES queda muy por debajo del techo de 4 GiB del ZIP clásico', () => {
    expect(MAX_ZIP_TOTAL_BYTES).toBe(oneGiB);
    expect(MAX_ZIP_TOTAL_BYTES * 4).toBeLessThanOrEqual(0xffffffff + 1);
  });

  it('acepta un lote que cabe', () => {
    const files = Array.from({ length: 100 }, (_, i) => ({
      name: `d${i}.pdf`,
      size: 4 * 1024 * 1024,
    }));
    expect(() => assertBatchFitsZip(files)).not.toThrow();
  });

  it('rechaza el lote que no cabe nombrando la causa y qué hacer, sin filtrar nombres', () => {
    const files = Array.from({ length: 60 }, (_, i) => ({
      name: `secreto-del-cliente-${i}.pdf`,
      size: 30 * 1024 * 1024,
    }));
    let caught: unknown;
    try {
      assertBatchFitsZip(files);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BatchZipCapacityError);
    const err = caught as BatchZipCapacityError;
    expect(err.code).toBe('zip_total_too_large');
    expect(err.message).toMatch(/1024 MB/);
    expect(err.message).toMatch(/[Dd]ivide el lote/);
    expect(err.message).toMatch(/tandas de ~\d+ archivo/);
    // El nombre de un documento es dato del usuario: no viaja en un Error que
    // cualquier manejador global podría loguear.
    expect(err.message).not.toMatch(/secreto-del-cliente/);
  });

  it('la estimación previa cuenta el crecimiento de la firma, no solo el tamaño de entrada', () => {
    const raw = 10 * 1024 * 1024;
    expect(estimateSignedZipBytes([raw])).toBeGreaterThan(raw);
  });

  it('rechaza más entradas de las que el directorio central puede indexar', () => {
    const files = Array.from({ length: 70_000 }, () => ({ name: 'x.pdf', size: 1 }));
    expect(() => assertBatchFitsZip(files)).toThrow(
      expect.objectContaining({ code: 'zip_too_many_entries' }) as Error,
    );
  });

  it('el escritor tiene su propia red: corta si el tope se rebasa en caliente', () => {
    const writer = new BatchZipWriter({ maxTotalBytes: 64 * 1024 });
    writer.addPdf('a.pdf', pdfOf(1, 32 * 1024));
    expect(() => writer.addPdf('b.pdf', pdfOf(2, 64 * 1024))).toThrow(BatchZipCapacityError);
    // Y lo que ya entró sigue siendo un ZIP válido.
    expect(writer.entries.map((e) => e.name)).toEqual(['a-firmado.pdf']);
  });
});
