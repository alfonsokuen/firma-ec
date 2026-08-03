/**
 * textBandsBudget.test.ts — cubre las señales POSITIVAS de rechazo/truncado
 * que `textBands.ts` emite hacia `TextRunObserver` (`discardPage`,
 * `truncatePage`) y la RAZÓN real que reporta `PageDecodeStats.pageRejected`
 * cuando el motivo es un presupuesto agotado, no un documento corrupto.
 *
 * Antes de esta ronda:
 *  - `discardPage` existía en el tipo pero NINGÚN test lo invocaba — se podía
 *    borrar la llamada entera sin que nada avisara (mutación #3).
 *  - `'budget_exhausted'` estaba declarado pero nunca asignado: rebasar
 *    `MAX_OPERATORS_PER_PAGE` reportaba `'unbalanced_state'` y rebasar
 *    `MAX_CONTENT_BYTES_PER_PAGE` reportaba `'stream_undecodable'` — la señal
 *    que existe para responder "¿la ceguera es nuestra o del PDF?" mentía
 *    justo en los dos casos donde es 100% nuestra.
 *  - un fallo del OBSERVADOR (bug propio) se desenvolvía con `throw
 *    err.cause` y perdía su marca, cayendo en el mismo `'unbalanced_state'`
 *    que un `Q` huérfano.
 */
import { PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import {
  MAX_CONTENT_BYTES_PER_PAGE,
  MAX_DECODED_CODES_PER_PAGE,
  MAX_OPERATORS_PER_PAGE,
  readTextBands,
  type PageDecodeStats,
  type TextRunObserver,
  type UnanalyzedReason,
} from '../src/textBands.js';

/** PDF de una página con UN font dict WinAnsi puro y el content stream dado. */
async function pdfWithPlainFont(content: string): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(content)));
  const font = doc.context.obj({
    Type: 'Font',
    Subtype: 'Type1',
    BaseFont: 'Helvetica',
    Encoding: 'WinAnsiEncoding',
  });
  const resources = doc.context.obj({ Font: doc.context.obj({ F1: doc.context.register(font) }) });
  page.node.set(PDFName.of('Resources'), resources);
  return PDFDocument.load(await doc.save());
}

/** PDF de una página cuyo `/Contents` es un stream de bytes crudos arbitrarios (sin pasar por un font). */
async function pdfWithRawContents(bytes: Uint8Array): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(bytes)));
  return PDFDocument.load(await doc.save());
}

interface RecordedDiscard {
  page: number;
  reason: UnanalyzedReason;
}

function recordingObserver(): {
  observer: TextRunObserver;
  discards: RecordedDiscard[];
  truncations: number[];
} {
  const discards: RecordedDiscard[] = [];
  const truncations: number[] = [];
  const observer: TextRunObserver = {
    beginLine() {},
    push() {},
    endLine() {},
    discardPage(page, reason) {
      discards.push({ page, reason });
    },
    truncatePage(page) {
      truncations.push(page);
    },
  };
  return { observer, discards, truncations };
}

describe('discardPage — mutación #3: la señal positiva ahora SÍ se invoca', () => {
  it('un fallo del observador dispara discardPage con reason "observer_failure" (no genérico)', async () => {
    const doc = await pdfWithPlainFont('BT /F1 12 Tf 1 0 0 1 50 700 Tm (Hola) Tj ET');
    const throwing: TextRunObserver = {
      beginLine() {},
      push() {
        throw new Error('bug del observador, plantado por el test');
      },
      endLine() {},
      discardPage(page, reason) {
        discards.push({ page, reason });
      },
    };
    const discards: RecordedDiscard[] = [];

    const stats: PageDecodeStats[] = [];
    const { unanalyzedPages } = readTextBands(doc, {
      textObserver: throwing,
      onPageDecodeStats: (s) => stats.push(s),
    });

    expect(unanalyzedPages).toEqual([0]);
    expect(discards).toEqual([{ page: 0, reason: 'observer_failure' }]);
    expect(stats[0]!.pageRejected).toBe('observer_failure');
    expect(stats[0]!.observerErrors).toBe(1);
  });

  it('rebasar MAX_OPERATORS_PER_PAGE dispara discardPage con reason "budget_exhausted" (antes: unbalanced_state)', async () => {
    // Un operador inocuo (`m`, moveto — no texto) repetido hasta pasarse del
    // tope: cada repetición aporta 3 tokens ("0", "0", "m").
    const repeats = Math.ceil(MAX_OPERATORS_PER_PAGE / 3) + 100;
    const content = '0 0 m\n'.repeat(repeats);
    const doc = await pdfWithPlainFont(content);
    const { observer, discards } = recordingObserver();
    const stats: PageDecodeStats[] = [];

    const { unanalyzedPages, unanalyzed } = readTextBands(doc, {
      textObserver: observer,
      onPageDecodeStats: (s) => stats.push(s),
    });

    expect(unanalyzedPages).toEqual([0]);
    expect(unanalyzed).toEqual([{ page: 0, reason: 'budget_exhausted' }]);
    expect(discards).toEqual([{ page: 0, reason: 'budget_exhausted' }]);
    expect(stats[0]!.pageRejected).toBe('budget_exhausted');
  });

  it('rebasar MAX_CONTENT_BYTES_PER_PAGE dispara discardPage con reason "budget_exhausted" (antes: stream_undecodable)', async () => {
    const oversized = new Uint8Array(MAX_CONTENT_BYTES_PER_PAGE + 1024).fill(0x41); // 'A' de relleno
    const doc = await pdfWithRawContents(oversized);
    const { observer, discards } = recordingObserver();
    const stats: PageDecodeStats[] = [];

    const { unanalyzedPages, unanalyzed } = readTextBands(doc, {
      textObserver: observer,
      onPageDecodeStats: (s) => stats.push(s),
    });

    expect(unanalyzedPages).toEqual([0]);
    expect(unanalyzed).toEqual([{ page: 0, reason: 'budget_exhausted' }]);
    expect(discards).toEqual([{ page: 0, reason: 'budget_exhausted' }]);
    expect(stats[0]!.pageRejected).toBe('budget_exhausted');
  });

  it('un stream genuinamente CORRUPTO (no presupuesto) sigue reportando stream_undecodable, no budget_exhausted', async () => {
    // Contenido que decodifica bien en tamaño (cabe de sobra en el
    // presupuesto) pero con un literal `(` sin cerrar: corrupción real del
    // stream, no agotamiento de ningún tope.
    const doc = await pdfWithPlainFont('BT /F1 12 Tf 1 0 0 1 50 700 Tm (sin cerrar');
    const { observer, discards } = recordingObserver();

    const { unanalyzed } = readTextBands(doc, { textObserver: observer });

    expect(unanalyzed).toEqual([{ page: 0, reason: 'unbalanced_state' }]);
    expect(discards).toEqual([{ page: 0, reason: 'unbalanced_state' }]);
  });
});

describe('truncatePage — el presupuesto de code points ahora SÍ avisa al observador (P1)', () => {
  it('MAX_DECODED_CODES_PER_PAGE agotado a media página: truncatePage se invoca UNA vez, y las BANDAS siguen presentes', async () => {
    // Dos líneas, cada una más grande que la mitad del presupuesto: la
    // primera se decodifica completa, la segunda se corta a mitad de
    // camino. La página NO debe rechazarse (discardPage NO se llama) —el
    // ancla es una mejora sobre las bandas, nunca un requisito— pero
    // `truncatePage` sí debe avisar de que el ancla quedó incompleta.
    const half = 'A'.repeat(Math.floor(MAX_DECODED_CODES_PER_PAGE * 0.6));
    const content = [
      `BT /F1 12 Tf 1 0 0 1 50 700 Tm (${half}) Tj ET`,
      `BT /F1 12 Tf 1 0 0 1 50 650 Tm (${half}) Tj ET`,
    ].join('\n');
    const doc = await pdfWithPlainFont(content);
    const { observer, discards, truncations } = recordingObserver();
    const stats: PageDecodeStats[] = [];

    const { unanalyzedPages, bands } = readTextBands(doc, {
      textObserver: observer,
      onPageDecodeStats: (s) => stats.push(s),
    });

    expect(unanalyzedPages).toEqual([]); // NO rechazada
    expect(discards).toEqual([]); // discardPage NUNCA se llama por esto
    expect(truncations).toEqual([0]); // truncatePage se llama UNA vez
    expect(bands.length).toBe(2); // las bandas geométricas sobreviven intactas
    expect(stats[0]!.scanIncomplete).toBe(true);
  });
});
