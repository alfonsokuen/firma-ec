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

const { placementOverrides, preflightBatch } = await import('./preflight');

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
});

afterEach(() => {
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

describe('placementOverrides', () => {
  it('indexa por posición y salta los documentos sin rect', async () => {
    computeMock
      .mockReturnValueOnce(PLACEMENT_OK)
      .mockReturnValueOnce({ status: 'needs_review', page: 0, reason: 'no_free_slot' })
      .mockReturnValueOnce({ ...PLACEMENT_OK, x: 111 });

    const report = await preflightBatch([pdf('uno.pdf'), pdf('dos.pdf'), pdf('tres.pdf')]);
    const overrides = placementOverrides(report.items);

    // El del medio no tiene rect, y eso NO desplaza al tercero: su clave sigue
    // siendo su posición real. Un corrimiento aquí estamparía en un documento
    // el sitio calculado para otro.
    expect([...overrides.keys()]).toEqual([0, 2]);
    expect(overrides.get(2)).toMatchObject({ x: 111 });
  });

  it('sin ningún rect publicado devuelve un mapa vacío, no uno con huecos', async () => {
    computeMock.mockReturnValue({ status: 'needs_review', page: 0, reason: 'no_free_slot' });

    const report = await preflightBatch([pdf('uno.pdf'), pdf('dos.pdf')]);
    expect(placementOverrides(report.items).size).toBe(0);
  });
});
