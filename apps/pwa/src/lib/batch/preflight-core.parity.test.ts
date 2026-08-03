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
import { describe, expect, it } from 'vitest';
import { analyzeForPreflight, type PreflightOutcome } from './preflight-core';

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
