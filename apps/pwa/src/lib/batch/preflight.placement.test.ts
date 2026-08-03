/**
 * El pre-vuelo como ÚNICA fuente del sitio de la firma.
 *
 * Antes, la pantalla calculaba la colocación para enseñarla y el worker la
 * volvía a calcular para firmar. Dos cálculos independientes sobre el mismo
 * documento pueden discrepar, y entonces se enseña una cosa y se hace otra.
 *
 * Al exportar el rect desaparece esa discrepancia, pero aparece un peligro: si
 * el rect viaja al firmante, el worker ya no analiza nada y sus guardas no
 * llegan a correr. De ahí lo que se fija aquí — el rect solo se publica cuando
 * el pre-vuelo reprodujo la decisión del worker entera, incluido el cruce
 * contra las firmas previas. En cualquier otro caso NO se publica y el
 * documento vuelve al camino automático de siempre.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const analyzeMock = vi.fn();
const computeMock = vi.fn();
const detectMock = vi.fn();

vi.mock('@firma-ec/signer', () => ({
  analyzePdfForPlacement: (...args: unknown[]) => analyzeMock(...args),
  computeAutoPlacement: (...args: unknown[]) => computeMock(...args),
  detectSignatures: (...args: unknown[]) => detectMock(...args),
}));

const { toBatchInput, preflightBatch } = await import('./preflight');
const { __setPreflightWorkerFactoryForTests } = await import('./preflight-bus');
const { analyzeForPreflight } = await import('./preflight-core');

/**
 * `preflightBatch` ahora delega el análisis a un Web Worker (F0 fase 2). Este
 * doble ejecuta la MISMA lógica que `preflight.worker.ts` — llama a
 * `analyzeForPreflight` de verdad, que a su vez llama a las funciones de
 * `@firma-ec/signer` MOCKEADAS arriba — para que estos tests sigan
 * ejerciendo exactamente el mismo cruce (`analyzeMock`/`computeMock`/
 * `detectMock`) que antes de mover el análisis fuera del hilo principal.
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

function pdf(name: string): File {
  return new File([new Uint8Array(8)], name, { type: 'application/pdf' });
}

/** Análisis sano de un documento de una página, sin firmas previas visibles. */
function analysisOk(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    geometry: [{ page: 0 }],
    existing: [],
    emptySigFields: [],
    textBands: [],
    unanalyzedPages: [],
    ...overrides,
  };
}

const PLACEMENT_OK = {
  status: 'ok',
  page: 0,
  x: 300,
  y: 40,
  w: 240,
  h: 72,
  rotate: 0,
  source: 'default-footer',
} as const;

beforeEach(() => {
  analyzeMock.mockReset().mockResolvedValue(analysisOk());
  computeMock.mockReset().mockReturnValue(PLACEMENT_OK);
  detectMock.mockReset().mockResolvedValue([]);
  __setPreflightWorkerFactoryForTests(() => new FakePreflightWorker() as unknown as Worker);
});

afterEach(() => {
  __setPreflightWorkerFactoryForTests(null);
  vi.restoreAllMocks();
});

describe('preflight — publicación del rect', () => {
  it('publica el rect calculado, con width/height y el rotate de la página', async () => {
    const report = await preflightBatch([pdf('uno.pdf')]);

    expect(report.items[0]!.status).toBe('ready');
    expect(report.items[0]!.placement).toEqual({
      page: 0,
      x: 300,
      y: 40,
      width: 240,
      height: 72,
      rotate: 0,
    });
  });

  it('no gasta una segunda lectura cuando la fuente no puede contradecirse', async () => {
    // `default-footer` no puede chocar con una firma previa: el cruce sobra, y
    // pagarlo en los 50 documentos del lote sería trabajo tirado.
    await preflightBatch([pdf('uno.pdf')]);
    expect(detectMock).not.toHaveBeenCalled();
  });

  it('con campo de firma vacío SÍ cruza contra las firmas previas', async () => {
    computeMock.mockReturnValue({ ...PLACEMENT_OK, source: 'empty-field' });

    await preflightBatch([pdf('uno.pdf')]);
    expect(detectMock).toHaveBeenCalledTimes(1);
  });

  it('aparta el documento cuyo "campo vacío" es en realidad una firma anterior', async () => {
    // El análisis no ve ninguna firma; `detectSignatures` sí. Firmar aquí
    // pondría la estampa con el rect EXACTO de la firma existente, encima, y el
    // lote lo contaría como éxito limpio.
    computeMock.mockReturnValue({ ...PLACEMENT_OK, source: 'empty-field' });
    detectMock.mockResolvedValue([{ page: 0 }]);

    const [item] = (await preflightBatch([pdf('uno.pdf')])).items;

    expect(item!.status).toBe('needs_review');
    expect(item!.reason).toBe('empty_field_conflicts_with_prior_signature');
    expect(item!.placement).toBeUndefined();
  });

  it('si el cruce no se puede hacer, no publica el rect en vez de publicarlo a ciegas', async () => {
    computeMock.mockReturnValue({ ...PLACEMENT_OK, source: 'empty-field' });
    detectMock.mockRejectedValue(new Error('lector caído'));

    const [item] = (await preflightBatch([pdf('uno.pdf')])).items;

    // Sigue firmable —el análisis lo leyó, así que es legible— pero sin rect:
    // cae a colocación automática y el worker rehace el cruce él mismo. Se
    // pierde el ahorro, nunca la comprobación.
    expect(item!.status).toBe('ready');
    expect(item!.placement).toBeUndefined();
  });

  it('un documento apartado no publica rect', async () => {
    computeMock.mockReturnValue({ status: 'needs_review', page: 0, reason: 'no_free_slot' });

    const [item] = (await preflightBatch([pdf('uno.pdf')])).items;
    expect(item!.status).toBe('needs_review');
    expect(item!.placement).toBeUndefined();
  });
});

describe('toBatchInput', () => {
  it('un documento sin rect no desplaza el de los siguientes', async () => {
    computeMock
      .mockReturnValueOnce(PLACEMENT_OK)
      .mockReturnValueOnce({ status: 'needs_review', page: 0, reason: 'no_free_slot' })
      .mockReturnValueOnce({ ...PLACEMENT_OK, x: 111 });

    const report = await preflightBatch([pdf('uno.pdf'), pdf('dos.pdf'), pdf('tres.pdf')]);
    const { files, visibleSigByIndex } = toBatchInput(report.items);

    // La clave de cada rect es la posición de SU fichero en `files`. Un
    // corrimiento aquí estamparía en un documento el sitio calculado para otro.
    expect(files).toHaveLength(3);
    expect([...visibleSigByIndex.keys()]).toEqual([0, 2]);
    expect(visibleSigByIndex.get(2)).toMatchObject({ x: 111 });
    for (const [index, rect] of visibleSigByIndex) {
      expect(files[index]).toBe(report.items[index]!.file);
      expect(rect).toEqual(report.items[index]!.placement);
    }
  });

  it('filtrar la lista mueve el fichero y su rect JUNTOS', async () => {
    // Este es el fallo que la función existe para impedir: cuando eran dos
    // llamadas, filtrar una lista y no la otra corría todos los rects un puesto
    // y cada documento se firmaba donde se revisó su vecino.
    computeMock
      .mockReturnValueOnce({ status: 'needs_review', page: 0, reason: 'no_free_slot' })
      .mockReturnValueOnce({ ...PLACEMENT_OK, x: 222 });

    const report = await preflightBatch([pdf('descartado.pdf'), pdf('bueno.pdf')]);
    const ready = report.items.filter((i) => i.status === 'ready');
    const { files, visibleSigByIndex } = toBatchInput(ready);

    // El bueno pasa a ser el primero del lote, y su rect viaja con él.
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(ready[0]!.file);
    expect([...visibleSigByIndex.keys()]).toEqual([0]);
    expect(visibleSigByIndex.get(0)).toMatchObject({ x: 222 });
  });

  it('sin ningún rect publicado devuelve un mapa vacío, no uno con huecos', async () => {
    computeMock.mockReturnValue({ status: 'needs_review', page: 0, reason: 'no_free_slot' });

    const report = await preflightBatch([pdf('uno.pdf'), pdf('dos.pdf')]);
    const { files, visibleSigByIndex } = toBatchInput(report.items);
    expect(files).toHaveLength(2);
    expect(visibleSigByIndex.size).toBe(0);
  });
});
