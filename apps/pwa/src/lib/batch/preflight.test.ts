import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_BATCH_FILES, MAX_BATCH_FILE_SIZE_BYTES } from '../workers/sign-queue';
import { __setPreflightWorkerFactoryForTests } from './preflight-bus';
import { analyzeForPreflight } from './preflight-core';
import {
  BATCH_UI_MAX_FILES,
  EFFECTIVE_MAX_FILES,
  type RejectionReason,
  acceptFiles,
  preflightBatch,
} from './preflight';

/**
 * `preflightBatch` ahora delega el análisis a un Web Worker (F0 fase 2). En
 * el proceso de tests no hay un `Worker` real, así que este doble ejecuta la
 * MISMA lógica que `preflight.worker.ts` — llama a `analyzeForPreflight` de
 * verdad, sin mockear `@firma-ec/signer` — para que estos tests sigan
 * probando el comportamiento observable de `preflightBatch` de punta a
 * punta, tal como antes de mover el análisis fuera del hilo principal.
 */
class FakePreflightWorker extends EventTarget {
  postMessage(msg: { kind: string; requestId: string; pdf: ArrayBuffer }): void {
    if (msg.kind !== 'analyzeNext') return;
    void analyzeForPreflight(new Uint8Array(msg.pdf))
      .then((outcome) => {
        this.dispatchEvent(
          Object.assign(new Event('message'), {
            data: { kind: 'analyzeResult', requestId: msg.requestId, outcome },
          }),
        );
      })
      .catch((e: unknown) => {
        const err = e as Error;
        this.dispatchEvent(
          Object.assign(new Event('message'), {
            data: {
              kind: 'analyzeError',
              requestId: msg.requestId,
              code: 'unknown',
              message: err?.message ?? String(e),
            },
          }),
        );
      });
  }

  terminate(): void {
    /* no-op fake */
  }
}

beforeEach(() => {
  __setPreflightWorkerFactoryForTests(() => new FakePreflightWorker() as unknown as Worker);
});

afterEach(() => {
  __setPreflightWorkerFactoryForTests(null);
});

/** Un File del tamaño pedido sin reservar los bytes de verdad. */
function fakeFile(name: string, size: number, type = 'application/pdf'): File {
  const file = new File([new Uint8Array(0)], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

const ONE_MB = 1024 * 1024;

function reasons(rejected: readonly { reason: RejectionReason }[]): RejectionReason[] {
  return rejected.map((r) => r.reason);
}

describe('EFFECTIVE_MAX_FILES', () => {
  it('nunca supera lo que el motor acepta', () => {
    expect(EFFECTIVE_MAX_FILES).toBeLessThanOrEqual(MAX_BATCH_FILES);
  });

  it('es el tope de producto mientras sea el más bajo de los dos', () => {
    expect(EFFECTIVE_MAX_FILES).toBe(Math.min(BATCH_UI_MAX_FILES, MAX_BATCH_FILES));
  });
});

describe('acceptFiles', () => {
  it('acepta PDFs por debajo del límite', () => {
    const { accepted, rejected } = acceptFiles([fakeFile('a.pdf', ONE_MB)]);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it('acepta por extensión aunque el navegador no reporte el MIME', () => {
    const { accepted } = acceptFiles([fakeFile('sin-mime.PDF', ONE_MB, '')]);
    expect(accepted).toHaveLength(1);
  });

  it('rechaza lo que no es PDF nombrando el motivo', () => {
    const { accepted, rejected } = acceptFiles([fakeFile('foto.jpg', ONE_MB, 'image/jpeg')]);
    expect(accepted).toHaveLength(0);
    expect(reasons(rejected)).toEqual(['not_pdf']);
  });

  it('rechaza un archivo de 0 bytes por vacío, no por "no es PDF"', () => {
    const { rejected } = acceptFiles([fakeFile('vacio.pdf', 0)]);
    expect(reasons(rejected)).toEqual(['empty']);
  });

  it('rechaza el que supera el máximo por archivo', () => {
    const { rejected } = acceptFiles([fakeFile('enorme.pdf', MAX_BATCH_FILE_SIZE_BYTES + 1)]);
    expect(reasons(rejected)).toEqual(['file_too_large']);
  });

  it('acepta exactamente el tamaño máximo (el límite no es off-by-one)', () => {
    const { accepted } = acceptFiles([fakeFile('justo.pdf', MAX_BATCH_FILE_SIZE_BYTES)]);
    expect(accepted).toHaveLength(1);
  });

  it('corta en el tope y marca el sobrante como too_many', () => {
    const many = Array.from({ length: EFFECTIVE_MAX_FILES + 3 }, (_, i) =>
      fakeFile(`doc-${i}.pdf`, ONE_MB),
    );
    const { accepted, rejected } = acceptFiles(many);
    expect(accepted).toHaveLength(EFFECTIVE_MAX_FILES);
    expect(reasons(rejected)).toEqual(['too_many', 'too_many', 'too_many']);
  });

  it('cuenta los ya elegidos: el tope es del lote, no de cada tanda', () => {
    const first = acceptFiles(
      Array.from({ length: EFFECTIVE_MAX_FILES }, (_, i) => fakeFile(`a-${i}.pdf`, ONE_MB)),
    );
    expect(first.accepted).toHaveLength(EFFECTIVE_MAX_FILES);

    // Segunda tanda con el lote ya lleno: nada entra, y se dice por qué.
    const second = acceptFiles([fakeFile('extra.pdf', ONE_MB)], first.accepted.length);
    expect(second.accepted).toHaveLength(0);
    expect(reasons(second.rejected)).toEqual(['too_many']);
  });

  it('no descarta en silencio: todo archivo sale aceptado o rechazado', () => {
    const input = [
      fakeFile('ok.pdf', ONE_MB),
      fakeFile('foto.png', ONE_MB, 'image/png'),
      fakeFile('vacio.pdf', 0),
      fakeFile('gordo.pdf', MAX_BATCH_FILE_SIZE_BYTES + 1),
    ];
    const { accepted, rejected } = acceptFiles(input);
    expect(accepted.length + rejected.length).toBe(input.length);
  });

  it('conserva el orden en que se soltaron', () => {
    const { accepted } = acceptFiles([
      fakeFile('1.pdf', ONE_MB),
      fakeFile('2.pdf', ONE_MB),
      fakeFile('3.pdf', ONE_MB),
    ]);
    expect(accepted.map((f) => f.name)).toEqual(['1.pdf', '2.pdf', '3.pdf']);
  });
});

/**
 * `preflightBatch` no tenía ni una prueba: toda la cobertura era de
 * `acceptFiles`. Lo que se fija aquí es lo que la revisión encontró roto — que
 * dos corridas consecutivas emitían los MISMOS ids y la lista acababa
 * mezclando documentos de ambas.
 */
describe('preflightBatch', () => {
  /** Un PDF de una página, mínimo pero válido. */
  function pdfFile(name: string): File {
    const pdf = [
      '%PDF-1.4',
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj',
      'trailer<</Root 1 0 R>>',
      '%%EOF',
    ].join('\n');
    return new File([new TextEncoder().encode(pdf)], name, { type: 'application/pdf' });
  }

  it('los ids de dos corridas distintas no chocan', async () => {
    const files = [pdfFile('a.pdf'), pdfFile('b.pdf')];

    const first = await preflightBatch(files, { runId: 'r1' });
    const second = await preflightBatch(files, { runId: 'r2' });

    expect(first.items.map((i) => i.id)).toEqual(['r1-0', 'r1-1']);
    expect(second.items.map((i) => i.id)).toEqual(['r2-0', 'r2-1']);
    const all = new Set([...first.items, ...second.items].map((i) => i.id));
    expect(all.size).toBe(4);
  });

  it('informa de cada documento mientras avanza, en orden', async () => {
    const files = [pdfFile('a.pdf'), pdfFile('b.pdf'), pdfFile('c.pdf')];
    const seen: number[] = [];

    const report = await preflightBatch(files, { onItem: (_item, index) => void seen.push(index) });

    expect(seen).toEqual([0, 1, 2]);
    expect(report.items).toHaveLength(3);
    expect(report.ready + report.needsReview + report.unreadable).toBe(3);
  });

  it('al abortar devuelve lo resuelto, no un informe a medias que parezca completo', async () => {
    const controller = new AbortController();
    const files = [pdfFile('a.pdf'), pdfFile('b.pdf'), pdfFile('c.pdf')];

    const report = await preflightBatch(files, {
      signal: controller.signal,
      onItem: () => controller.abort(),
    });

    expect(report.items).toHaveLength(1);
    expect(report.items[0]?.id).toBe('pf-0');
  });

  it('un archivo que no es un PDF sale "unreadable", no revienta el lote', async () => {
    const files = [new File([new Uint8Array([1, 2, 3])], 'roto.pdf', { type: 'application/pdf' })];

    const report = await preflightBatch(files);

    expect(report.unreadable).toBe(1);
    expect(report.items[0]?.status).toBe('unreadable');
  });
});
