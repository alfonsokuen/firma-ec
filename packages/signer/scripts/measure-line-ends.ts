/**
 * measure-line-ends.ts — vuelca el borde derecho ESTIMADO de cada linea
 * (`LineStart.end`) para un corpus de PDFs, y de paso el rect que el motor
 * colocaria en cada uno. Ejecutar con:
 *   pnpm build && node --experimental-strip-types scripts/measure-line-ends.ts <dir> <salida.json>
 *
 * Existe para poder CONTRASTAR la estimacion contra una medida independiente
 * (pymupdf `page.get_text('words')`, que si conoce las metricas de la fuente
 * incrustada) sobre documentos reales, en vez de darla por buena porque los
 * fixtures pasan. El criterio con el que se acepto: error mediano <= 3 pt y
 * maximo <= 8 pt en las lineas del bloque de firma.
 *
 * Solo LEE los `.pdf` del directorio que se le pase por argumento —ninguna
 * ruta va incrustada— y no escribe nunca dentro del corpus. Lo que vuelca son
 * COORDENADAS, jamas texto del documento.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { analyzePdfForPlacement } from '../dist/analyzePdf.js';
import { computeAutoPlacement } from '../dist/autoPlacement.js';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) {
  console.error('uso: measure-line-ends.ts <dir-con-pdfs> <salida.json>');
  process.exit(2);
}

const report: Record<string, unknown> = {};
for (const file of readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf'))) {
  const bytes = new Uint8Array(readFileSync(join(dir, file)));
  const analysis = await analyzePdfForPlacement(bytes);
  const placement = computeAutoPlacement({
    geometry: analysis.geometry,
    existing: analysis.existing,
    emptySigFields: analysis.emptySigFields,
    textBands: analysis.textBands,
    unanalyzedPages: analysis.unanalyzedPages,
  });
  report[file.replace(/\.pdf$/i, '')] = {
    failure: analysis.failure ?? null,
    unanalyzedPages: analysis.unanalyzedPages,
    geometry: analysis.geometry,
    existing: analysis.existing,
    placement,
    bands: analysis.textBands.map((b) => ({
      page: b.page,
      y: b.y,
      h: b.h,
      x: b.x ?? null,
      end: b.end ?? null,
      starts: (b.starts ?? []).map((s) => ({ x: s.x, y: s.y, end: s.end ?? null })),
    })),
  };
}
writeFileSync(out, JSON.stringify(report));
console.log(`escrito ${out} (${Object.keys(report).length} documentos)`);
