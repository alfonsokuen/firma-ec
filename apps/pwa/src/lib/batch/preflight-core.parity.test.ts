/**
 * Candado de "no cambió nada" del movimiento de F0 fase 1.
 *
 * `analyzeForPreflight` es el núcleo de `preflightOne` extraído a
 * `preflight-core.ts`. La tabla de abajo es la salida CONGELADA de la función
 * real (`preflightOne`, tal como vivía en `preflight.ts` antes de la
 * extracción) corriendo sobre el corpus de fixtures reales del proyecto — se
 * capturó ejecutando ese código, byte a byte, antes de mover una sola línea.
 *
 * Un cambio en esta tabla es señal de BUG en el movimiento, no de mejora: la
 * fase 1 es un refactor puro, la decisión de colocación no se toca.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzePdfForPlacement, computeAutoPlacement, toCanonicalRect } from '@firma-ec/signer';
import { describe, expect, it } from 'vitest';
import { buildMinimalPdfBuffer } from '../workers/minimalPdf.fixture';
import { type PreflightOutcome, analyzeForPreflight } from './preflight-core';
import type { PropagationHint } from './propagation';

const VERIFIER_FIXTURES = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'verifier',
  'tests',
  'fixtures',
);
const E2E_FIXTURES = join(__dirname, '..', '..', '..', 'tests', 'e2e', 'fixtures');

/** El corpus vive repartido en dos paquetes; se busca por nombre, no por prefijo. */
function fixture(name: string): string {
  const candidate = join(VERIFIER_FIXTURES, name);
  return existsSync(candidate) ? candidate : join(E2E_FIXTURES, name);
}

interface FrozenRow {
  readonly status: PreflightOutcome['status'];
  readonly page: number;
  readonly pageCount: number;
  readonly reason: string | undefined;
  readonly source: PreflightOutcome['source'] | undefined;
  readonly hasPlacement: boolean;
}

/**
 * Salida congelada de `preflightOne` (la lógica que hoy vive en
 * `analyzeForPreflight`) sobre el corpus real de `packages/verifier/tests/fixtures`
 * y `apps/pwa/tests/e2e/fixtures`, capturada ANTES/DURANTE la extracción de F0
 * fase 1 con el código sin mover.
 */
const FROZEN_TABLE: Record<string, FrozenRow> = {
  'audit-075-2026.pdf': {
    status: 'ready',
    page: 3,
    pageCount: 4,
    reason: undefined,
    source: 'anti-overlap',
    hasPlacement: true,
  },
  'audit-075-firmado.pdf': {
    status: 'ready',
    page: 3,
    pageCount: 4,
    reason: undefined,
    source: 'anti-overlap',
    hasPlacement: true,
  },
  'bb-valid.pdf': {
    status: 'ready',
    page: 0,
    pageCount: 1,
    reason: undefined,
    source: 'default-footer',
    hasPlacement: true,
  },
  'carta-arrendamiento-firmado.pdf': {
    status: 'needs_review',
    page: 0,
    pageCount: 1,
    reason: 'no_free_slot',
    source: undefined,
    hasPlacement: false,
  },
  'eci-real-contrato2026.pdf': {
    status: 'ready',
    page: 3,
    pageCount: 4,
    reason: undefined,
    source: 'anti-overlap',
    hasPlacement: true,
  },
  'eci-real-lideres.pdf': {
    status: 'ready',
    page: 3,
    pageCount: 4,
    reason: undefined,
    source: 'anti-overlap',
    hasPlacement: true,
  },
  'eci-real-signed.pdf': {
    status: 'ready',
    page: 3,
    pageCount: 4,
    reason: undefined,
    source: 'anti-overlap',
    hasPlacement: true,
  },
  'expired-cert.pdf': {
    status: 'ready',
    page: 0,
    pageCount: 1,
    reason: undefined,
    source: 'default-footer',
    hasPlacement: true,
  },
  'hash-mismatch.pdf': {
    status: 'unreadable',
    page: 0,
    pageCount: 0,
    reason: 'unreadable',
    source: undefined,
    hasPlacement: false,
  },
  'incremental-tampered.pdf': {
    status: 'ready',
    page: 0,
    pageCount: 1,
    reason: undefined,
    source: 'default-footer',
    hasPlacement: true,
  },
  'rsa-1024.pdf': {
    status: 'ready',
    page: 0,
    pageCount: 1,
    reason: undefined,
    source: 'default-footer',
    hasPlacement: true,
  },
  'sample-b-b-no-tsa.pdf': {
    status: 'ready',
    page: 0,
    pageCount: 1,
    reason: undefined,
    source: 'free-space',
    hasPlacement: true,
  },
  'sample-b-t-freetsa.pdf': {
    status: 'ready',
    page: 0,
    pageCount: 1,
    reason: undefined,
    source: 'free-space',
    hasPlacement: true,
  },
  'unsigned.pdf': {
    status: 'ready',
    page: 0,
    pageCount: 1,
    reason: undefined,
    source: 'default-footer',
    hasPlacement: true,
  },
  'untrusted-root.pdf': {
    status: 'ready',
    page: 0,
    pageCount: 1,
    reason: undefined,
    source: 'default-footer',
    hasPlacement: true,
  },
  'weak-sha1.pdf': {
    status: 'ready',
    page: 0,
    pageCount: 1,
    reason: undefined,
    source: 'default-footer',
    hasPlacement: true,
  },
  'sample-b-t.pdf': {
    status: 'ready',
    page: 0,
    pageCount: 1,
    reason: undefined,
    source: 'free-space',
    hasPlacement: true,
  },
  'sample.pdf': {
    status: 'ready',
    page: 0,
    pageCount: 1,
    reason: undefined,
    source: 'free-space',
    hasPlacement: true,
  },
};

describe('analyzeForPreflight — paridad con el algoritmo pre-extracción', () => {
  for (const [name, expected] of Object.entries(FROZEN_TABLE)) {
    it(name, async () => {
      const pdfBytes = new Uint8Array(readFileSync(fixture(name)));
      const outcome = await analyzeForPreflight(pdfBytes);

      expect({
        status: outcome.status,
        page: outcome.page,
        pageCount: outcome.pageCount,
        reason: outcome.reason,
        source: outcome.source,
        hasPlacement: outcome.placement !== undefined,
      }).toEqual(expected);
    });
  }

  it('cubre el corpus completo (16 fixtures de packages/verifier + 2 propias de apps/pwa e2e)', () => {
    expect(Object.keys(FROZEN_TABLE)).toHaveLength(18);
  });
});

/**
 * F2b — `analyzeForPreflight` con `placementHint`.
 *
 * Un PDF de una página sin widgets ni texto siempre resuelve por
 * `default-footer` (fuente 3, `autoPlacement.ts`): sin obstáculos,
 * `enumerateSlots` devuelve `[]` de inmediato (`onPage.length === 0`), así
 * que el ancla del hint NUNCA se honra en este documento — la posición final
 * depende solo de `boxW`/`boxH`, nunca de `preferredV`/`preferredU`. Eso es
 * justo lo que hace determinista comparar contra una posición conocida sin
 * tener que reimplementar `centeredU`.
 */
function noObstaclesPdf(): Uint8Array {
  return new Uint8Array(buildMinimalPdfBuffer([{}]));
}

/** Un campo de firma vacío del tamaño exacto de la caja por defecto. */
function emptyFieldPdf(): Uint8Array {
  return new Uint8Array(buildMinimalPdfBuffer([{ widgets: [{ rect: [100, 100, 340, 172] }] }]));
}

/**
 * Un PDF con una firma previa VISIBLE ya puesta (widget `/FT /Sig` con
 * `/V`), en la esquina inferior izquierda — el único caso en el que el
 * mecanismo de ancla del motor (`computeAntiOverlapPlacement`, rama
 * `anchor !== undefined`) puede de verdad decidir algo: sin ninguna firma
 * previa, `enumerateSlots` corta en `onPage.length === 0` (ver
 * `noObstaclesPdf` arriba) y el ancla NUNCA se honra. Página A4 sin
 * `/CropBox` (visX=visY=0, rotate=0) para que el espacio canónico coincida
 * con las coordenadas absolutas del PDF y las cuentas de más abajo sean
 * verificables a mano.
 */
function priorSignaturePdf(): Uint8Array {
  return new Uint8Array(
    buildMinimalPdfBuffer([{ widgets: [{ rect: [50, 50, 250, 100], signed: true }] }]),
  );
}

describe('analyzeForPreflight — sin opts, comportamiento idéntico al de hoy', () => {
  it('la salida sin placementHint es la misma que sin el segundo argumento en absoluto', async () => {
    const pdfBytes = noObstaclesPdf();
    const withoutArg = await analyzeForPreflight(pdfBytes);
    const withEmptyOpts = await analyzeForPreflight(pdfBytes, {});

    expect(withEmptyOpts).toEqual(withoutArg);
  });
});

describe('analyzeForPreflight — placementHint', () => {
  it('paridad: mismo resultado que llamar computeAutoPlacement directo con el mismo anchor/boxW/boxH', async () => {
    const pdfBytes = noObstaclesPdf();
    const analysis = await analyzePdfForPlacement(pdfBytes);
    const hint: PropagationHint = {
      page: 0,
      preferredV: 200,
      preferredU: 150,
      boxW: 200,
      boxH: 60,
    };

    const direct = computeAutoPlacement({
      geometry: analysis.geometry,
      existing: analysis.existing,
      emptySigFields: analysis.emptySigFields,
      textBands: analysis.textBands,
      unanalyzedPages: analysis.unanalyzedPages,
      boxW: hint.boxW,
      boxH: hint.boxH,
      anchor: {
        page: hint.page,
        preferredV: hint.preferredV,
        preferredU: hint.preferredU,
        kind: 'lote-propagacion',
      },
    });
    expect(direct.status).toBe('ok');
    if (direct.status !== 'ok') throw new Error('unreachable');

    const outcome = await analyzeForPreflight(pdfBytes, { placementHint: hint });

    expect(outcome.status).toBe('ready');
    expect(outcome.page).toBe(direct.page);
    expect(outcome.placement).toEqual({
      page: direct.page,
      x: direct.x,
      y: direct.y,
      width: direct.w,
      height: direct.h,
      rotate: direct.rotate,
    });
  });

  it('clasifica "exact" cuando el rect resultante cae donde pedía el hint', async () => {
    const pdfBytes = noObstaclesPdf();
    const baseline = await analyzeForPreflight(pdfBytes);
    expect(baseline.status).toBe('ready');
    expect(baseline.placement).toBeDefined();

    // El hint reproduce EXACTAMENTE la posición que ya cae ahí sin ayuda
    // (mismo boxW/boxH que usó el baseline: 240x72, el default) — la
    // clasificación debe reconocer que coincide, aunque `default-footer`
    // nunca haya mirado el hint para decidir.
    const hint: PropagationHint = {
      page: 0,
      preferredU: baseline.placement!.x,
      preferredV: baseline.placement!.y,
      boxW: baseline.placement!.width,
      boxH: baseline.placement!.height,
    };

    const outcome = await analyzeForPreflight(pdfBytes, { placementHint: hint });
    expect(outcome.propagated).toBe('exact');
  });

  it('clasifica "moved" cuando el motor reubica en otra página', async () => {
    const pdfBytes = noObstaclesPdf();
    const baseline = await analyzeForPreflight(pdfBytes);

    const hint: PropagationHint = {
      page: 99, // página que no existe en este documento de 1 sola página
      preferredU: baseline.placement!.x,
      preferredV: baseline.placement!.y,
      boxW: baseline.placement!.width,
      boxH: baseline.placement!.height,
    };

    const outcome = await analyzeForPreflight(pdfBytes, { placementHint: hint });
    expect(outcome.propagated).toBe('moved');
  });

  it('borde del epsilon de 0.5pt: 0.5 exacto cuenta como "exact", 0.51 ya es "moved"', async () => {
    const pdfBytes = noObstaclesPdf();
    const baseline = await analyzeForPreflight(pdfBytes);

    const atEpsilon: PropagationHint = {
      page: 0,
      preferredU: baseline.placement!.x,
      preferredV: baseline.placement!.y + 0.5,
      boxW: baseline.placement!.width,
      boxH: baseline.placement!.height,
    };
    const overEpsilon: PropagationHint = { ...atEpsilon, preferredV: baseline.placement!.y + 0.51 };

    const atOutcome = await analyzeForPreflight(pdfBytes, { placementHint: atEpsilon });
    const overOutcome = await analyzeForPreflight(pdfBytes, { placementHint: overEpsilon });

    expect(atOutcome.propagated).toBe('exact');
    expect(overOutcome.propagated).toBe('moved');
  });

  it('con emptySigFields, el campo vacío gana y propagated queda ausente (el hint ni se evaluó)', async () => {
    const pdfBytes = emptyFieldPdf();
    const hint: PropagationHint = {
      page: 0,
      preferredV: 400,
      preferredU: 200,
      boxW: 240,
      boxH: 72,
    };

    const outcome = await analyzeForPreflight(pdfBytes, { placementHint: hint });

    expect(outcome.status).toBe('ready');
    expect(outcome.source).toBe('empty-field');
    expect(outcome.propagated).toBeUndefined();
  });

  it('adjunta geometry siempre, con y sin hint', async () => {
    const pdfBytes = noObstaclesPdf();
    const withoutHint = await analyzeForPreflight(pdfBytes);
    const hint: PropagationHint = { page: 0, preferredV: 18, preferredU: 100, boxW: 240, boxH: 72 };
    const withHint = await analyzeForPreflight(pdfBytes, { placementHint: hint });

    expect(withoutHint.geometry).toHaveLength(1);
    expect(withHint.geometry).toHaveLength(1);
  });

  /**
   * Hallazgo 1 (QA F2b, confirmado por code-reviewer Y silent-failure-hunter
   * con mutation testing): promovida desde el scratch `__repro3_f2b` de un
   * revisor. Los tests de arriba usan `noObstaclesPdf`, donde
   * `enumerateSlots` corta en `onPage.length === 0` — el ancla NUNCA llega a
   * evaluarse ahí, y "exact"/"moved" "aciertan" sin que el mecanismo real
   * haya hecho nada. Confirmado con mutation testing: borrar el bloque
   * `anchor` de `preflight-core.ts` (el spread condicional que arma
   * `boxW`/`boxH`/`anchor`) deja los 1174 tests del repo en verde.
   *
   * Este test usa `priorSignaturePdf` (una firma previa VISIBLE), el único
   * caso donde el ancla de `computeAutoPlacement` (fuente 1.5,
   * `tryAnchorPlacement` en `autoPlacement.ts`) decide de verdad — sin
   * ninguna firma previa la rama nunca se alcanza. El hint pide un sitio
   * (u=100, v=700) deliberadamente LEJOS de donde caería sin ancla (el
   * barrido bottom-up sin hint elige u=264, v=50 con la caja por DEFECTO
   * 240x72 — ver el test de control de abajo): si el mutante borra el
   * bloque `anchor`, el resultado cae en esa posición sin ancla y este test
   * debe fallar.
   */
  it('el ancla decide de verdad cuando SÍ hay un obstáculo (firma previa visible)', async () => {
    const pdfBytes = priorSignaturePdf();
    const hint: PropagationHint = {
      page: 0,
      preferredU: 100,
      preferredV: 700,
      boxW: 200,
      boxH: 60,
    };

    const outcome = await analyzeForPreflight(pdfBytes, { placementHint: hint });

    expect(outcome.status).toBe('ready');
    // Fuente 1.5 (ancla), no anti-solape "a secas": con firma previa visible
    // Y ancla activa, `tryAnchorPlacement` prueba PRIMERO — y aquí encuentra
    // sitio para el hint sin tocar el fallback del anti-solape.
    expect(outcome.source).toBe('text-anchor');
    // Sin el mecanismo de ancla, el anti-solape habría elegido el primer
    // hueco libre junto a la firma existente (u=264, v=50, con la caja por
    // DEFECTO 240x72) — nada que ver con lo que pide el hint. Que el rect
    // final caiga EXACTO en (100, 700, 200, 60) prueba que el hint llegó al
    // motor y lo honró.
    expect(outcome.placement).toEqual({
      page: 0,
      x: 100,
      y: 700,
      width: 200,
      height: 60,
      rotate: 0,
    });
    expect(outcome.propagated).toBe('exact');
  });

  it('sin hint, el mismo documento con obstáculo cae en el hueco del barrido normal (control del test de arriba)', async () => {
    const pdfBytes = priorSignaturePdf();

    const outcome = await analyzeForPreflight(pdfBytes);

    expect(outcome.status).toBe('ready');
    expect(outcome.source).toBe('anti-overlap');
    expect(outcome.placement).toEqual({
      page: 0,
      x: 264,
      y: 50,
      width: 240,
      height: 72,
      rotate: 0,
    });
  });

  /**
   * Hallazgo 2 (QA F2b): `classifyPropagation` comparaba SOLO x/y — un rect
   * que cae en el x/y exacto pedido pero con un tamaño encogido por el
   * anti-solape (`Math.min(boxW, orientedW*0.6)`/`Math.min(boxH,
   * orientedH*0.2)`) salía "exact" igual, contradiciendo el propósito
   * documentado de propagar el tamaño confirmado.
   *
   * `boxW/boxH: 500x300` es demasiado grande para que la fuente 1.5 (ancla
   * directa, `tryAnchorPlacement`, que usa la caja SIN encoger) honre el
   * `v` pedido — con esa caja, `maxV` cae por debajo de `preferredV` y el
   * hueco más cercano queda a 76pt del pedido, fuera de la tolerancia
   * estricta (0.01) de esa fuente. La fuente cae al anti-solape "de
   * verdad" (`computeAntiOverlapPlacement`), que SÍ encoge la caja
   * (357.168×168.378) — y con la caja más chica, `preferredV=600` cabe
   * exacto (su propio `maxV` es más alto). Resultado: x/y caen EXACTOS en
   * el hint, w/h no — el caso que `classifyPropagation` debe distinguir.
   */
  it('clasifica "moved" cuando x/y coinciden pero el motor encogió w/h', async () => {
    const pdfBytes = priorSignaturePdf();
    const hint: PropagationHint = {
      page: 0,
      preferredU: 100,
      preferredV: 600,
      boxW: 500,
      boxH: 300,
    };

    const outcome = await analyzeForPreflight(pdfBytes, { placementHint: hint });

    expect(outcome.status).toBe('ready');
    expect(outcome.source).toBe('anti-overlap');
    expect(outcome.placement?.x).toBe(100);
    expect(outcome.placement?.y).toBe(600);
    expect(outcome.placement?.width).not.toBe(hint.boxW);
    expect(outcome.placement?.height).not.toBe(hint.boxH);
    expect(outcome.propagated).toBe('moved');
  });

  /**
   * Hallazgos 3+4 (QA F2b): un hint con algún número no finito, o con
   * `boxW`/`boxH` ≤ 0, se rechaza ANTES de tocar el motor — no llega a
   * `computeAutoPlacement` en absoluto (ni `boxW`/`boxH` ni `anchor`), y el
   * outcome lo dice con `propagated: 'hint_rejected'`, distinto de `'moved'`
   * (hint válido, el motor decidió otra cosa) y sin degradar a un
   * `needs_review` que culpe al documento.
   */
  it.each([
    ['preferredV NaN', { page: 0, preferredU: 100, preferredV: Number.NaN, boxW: 240, boxH: 72 }],
    [
      'preferredU Infinity',
      { page: 0, preferredU: Number.POSITIVE_INFINITY, preferredV: 18, boxW: 240, boxH: 72 },
    ],
    ['boxW NaN', { page: 0, preferredU: 100, preferredV: 18, boxW: Number.NaN, boxH: 72 }],
    ['boxW negativo', { page: 0, preferredU: 100, preferredV: 18, boxW: -240, boxH: 72 }],
    ['boxH cero', { page: 0, preferredU: 100, preferredV: 18, boxW: 240, boxH: 0 }],
  ] satisfies [string, PropagationHint][])(
    'hint corrupto (%s) degrada a hint_rejected, no a needs_review',
    async (_label, hint) => {
      const pdfBytes = noObstaclesPdf();
      const baseline = await analyzeForPreflight(pdfBytes);

      const outcome = await analyzeForPreflight(pdfBytes, { placementHint: hint });

      expect(outcome.status).toBe('ready');
      expect(outcome.propagated).toBe('hint_rejected');
      // El documento se coloca EXACTAMENTE como si no hubiera hint — el
      // rechazo pasa por delante del motor, no lo altera.
      expect(outcome.placement).toEqual(baseline.placement);
    },
  );

  it('un hint válido que el motor SÍ evalúa nunca sale hint_rejected', async () => {
    const pdfBytes = noObstaclesPdf();
    const hint: PropagationHint = { page: 0, preferredV: 18, preferredU: 100, boxW: 240, boxH: 72 };

    const outcome = await analyzeForPreflight(pdfBytes, { placementHint: hint });

    expect(outcome.propagated).not.toBe('hint_rejected');
  });
});
