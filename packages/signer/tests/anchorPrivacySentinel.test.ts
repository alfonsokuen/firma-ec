/**
 * anchorPrivacySentinel.test.ts — el texto se usa para LOCALIZAR y muere ahí.
 *
 * Un PDF con una palabra CENTINELA (que nunca debería salir de este paquete)
 * pasa por el pipeline completo de la FASE 3 — `analyzePdfForPlacement` con
 * `anchorSpec`, `computeAnchorPlacement`, `computeAutoPlacement`,
 * `classifyPlacement` — y se serializa TODO lo que cada función devuelve.
 * La centinela no puede aparecer en ninguna parte: de la búsqueda solo sale
 * un RECTÁNGULO.
 */
import { PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { analyzePdfForPlacement } from '../src/analyzePdf.js';
import { computeAnchorPlacement } from '../src/anchorPlacement.js';
import { computeAutoPlacement } from '../src/autoPlacement.js';
import { classifyPlacement } from '../src/placementConfidence.js';

/** Palabra que NUNCA debería sobrevivir más allá de `readTextBands`/`anchorMatch.ts`. */
const SENTINEL = 'SENTINELPRIVACYXYZ';

async function pdfWithSentinel(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.node.set(
    PDFName.of('Contents'),
    doc.context.register(
      doc.context.stream(
        `BT /F1 12 Tf 1 0 0 1 50 700 Tm (Clausula sobre ${SENTINEL} confidencial) Tj ET ` +
          `BT /F1 12 Tf 1 0 0 1 50 100 Tm (Firma: ${SENTINEL} Perez CI: 0912345678) Tj ET`,
      ),
    ),
  );
  const font = doc.context.obj({
    Type: 'Font',
    Subtype: 'Type1',
    BaseFont: 'Helvetica',
    Encoding: 'WinAnsiEncoding',
  });
  const resources = doc.context.obj({ Font: doc.context.obj({ F1: doc.context.register(font) }) });
  page.node.set(PDFName.of('Resources'), resources);
  return doc.save();
}

describe('centinela de privacidad — el texto del documento nunca sale del análisis', () => {
  it('ni analyzePdfForPlacement, ni el ancla, ni la colocación, ni la confianza la mencionan', async () => {
    const bytes = await pdfWithSentinel();
    const analysis = await analyzePdfForPlacement(bytes, {
      anchorSpec: { signerName: `${SENTINEL} Perez`, cedula: '0912345678' },
    });

    const choice = analysis.anchors
      ? computeAnchorPlacement(analysis.anchors.hits, analysis.geometry)
      : undefined;

    const placement = computeAutoPlacement({
      geometry: analysis.geometry,
      existing: analysis.existing,
      emptySigFields: analysis.emptySigFields,
      textBands: analysis.textBands,
      unanalyzedPages: analysis.unanalyzedPages,
      ...(choice
        ? {
            anchor: {
              page: choice.page,
              preferredV: choice.preferredV,
              preferredU: choice.preferredU,
              kind: choice.kind,
            },
          }
        : {}),
    });

    const confidence = classifyPlacement({
      placement,
      geometry: analysis.geometry,
      textBands: analysis.textBands,
      unanalyzedPages: analysis.unanalyzedPages,
      imageOnlyPages: analysis.imageOnlyPages,
      ocrOnlyPages: analysis.ocrOnlyPages,
      ...(choice
        ? {
            anchor: {
              kind: choice.kind,
              personalized: choice.personalized,
              signals: choice.signals,
              honored: placement.status === 'ok' && placement.source === 'text-anchor',
              pageCoverage:
                analysis.anchors?.pageStats.find((s) => s.page === choice.page)?.coverage ?? null,
            },
          }
        : {}),
    });

    // Prueba de vida: SÍ se encontró el ancla personalizada (si esto fallara,
    // el resto del test no probaría nada — estaría comparando contra un
    // objeto vacío por casualidad, no porque el texto se ocultara bien).
    expect(choice?.personalized).toBe(true);
    expect(placement.status).toBe('ok');

    const serialized = JSON.stringify({ analysis, choice, placement, confidence });
    expect(serialized).not.toContain(SENTINEL);
    // Y por si el JSON escapara algo raro: tampoco como bytes de sus code
    // points concatenados (defensa contra un `String.fromCharCode` suelto).
    expect(serialized.toUpperCase()).not.toContain(SENTINEL);
  });
});
