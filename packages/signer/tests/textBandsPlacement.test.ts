/**
 * La estampa no debe caer encima del texto.
 *
 * Se comprueba sobre documentos REALES (contratos y actas del corpus), no sobre
 * un PDF sintético: el defecto que motiva esto apareció justamente en un
 * contrato cuyo último párrafo llegaba hasta el pie de página, donde la
 * colocación automática apoyaba la firma a ciegas.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { analyzePdfForPlacement } from '../src/analyzePdf.js';
import { computeAutoPlacement } from '../src/autoPlacement.js';
import { readTextBands } from '../src/textBands.js';

const VERIFIER_FIXTURES = join(__dirname, '..', '..', 'verifier', 'tests', 'fixtures');
const E2E_FIXTURES = join(__dirname, '..', '..', '..', 'apps', 'pwa', 'tests', 'e2e', 'fixtures');

const REAL_DOCS = [
  join(VERIFIER_FIXTURES, 'eci-real-lideres.pdf'),
  join(VERIFIER_FIXTURES, 'carta-arrendamiento-firmado.pdf'),
  join(VERIFIER_FIXTURES, 'audit-075-firmado.pdf'),
  join(VERIFIER_FIXTURES, 'eci-real-contrato2026.pdf'),
  join(E2E_FIXTURES, 'sample.pdf'),
];

describe('readTextBands', () => {
  it('encuentra el texto de un PDF que lo tiene', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 600]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('Cláusula primera', { x: 50, y: 500, size: 12, font });
    page.drawText('Cláusula segunda', { x: 50, y: 60, size: 12, font });

    const loaded = await PDFDocument.load(await doc.save());
    const bands = readTextBands(loaded);

    expect(bands.length).toBeGreaterThan(0);
    expect(bands.every((b) => b.page === 0)).toBe(true);
    // Una banda cubre la línea de arriba y otra la de abajo.
    expect(bands.some((b) => b.y < 100)).toBe(true);
    expect(bands.some((b) => b.y > 400)).toBe(true);
  });

  it('un documento sin texto no produce bandas', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 600]);
    const loaded = await PDFDocument.load(await doc.save());

    expect(readTextBands(loaded)).toEqual([]);
  });
});

describe('la colocación automática no tapa el texto', () => {
  for (const path of REAL_DOCS) {
    it(`${path.split(/[\\/]/).pop()}`, async () => {
      const bytes = new Uint8Array(readFileSync(path));
      const analysis = await analyzePdfForPlacement(bytes);
      const placement = computeAutoPlacement({
        geometry: analysis.geometry,
        existing: analysis.existing,
        emptySigFields: analysis.emptySigFields,
        textBands: analysis.textBands,
      });

      // Apartar el documento es una respuesta legítima: mejor sin firmar que
      // firmado encima de una cláusula.
      if (placement.status !== 'ok') return;

      const bandsOnPage = analysis.textBands.filter((b) => b.page === placement.page);
      const stampTop = placement.y + placement.h;
      const overlapping = bandsOnPage.filter(
        (band) => band.y < stampTop && band.y + band.h > placement.y,
      );

      expect(overlapping).toEqual([]);
    });
  }

  it('sin bandas se comporta igual que antes (pie de página)', async () => {
    const bytes = new Uint8Array(readFileSync(join(E2E_FIXTURES, 'sample.pdf')));
    const analysis = await analyzePdfForPlacement(bytes);

    const withoutBands = computeAutoPlacement({
      geometry: analysis.geometry,
      existing: analysis.existing,
      emptySigFields: analysis.emptySigFields,
    });

    expect(withoutBands.status).toBe('ok');
    if (withoutBands.status === 'ok') expect(withoutBands.source).toBe('default-footer');
  });
});
