/**
 * propagation.ts — pruebas del núcleo puro de F2b.
 *
 * Sin DOM real: solo se usa `File` como contenedor vacío para satisfacer el
 * tipo `PreflightItem.file` — ningún test aquí lee sus bytes.
 */
import { type PageGeometry, toCanonicalRect } from '@firma-ec/signer';
import { describe, expect, it } from 'vitest';
import type { PreflightItem } from './preflight';
import {
  buildPropagationHint,
  geometrySignature,
  mergePropagationResult,
  propagationCandidates,
} from './propagation';

function pageGeo(overrides: Partial<PageGeometry> = {}): PageGeometry {
  return {
    page: 0,
    mediaW: 612,
    mediaH: 792,
    mediaX: 0,
    mediaY: 0,
    visX: 0,
    visY: 0,
    visW: 612,
    visH: 792,
    rotate: 0,
    ...overrides,
  };
}

function fakeFile(name = 'doc.pdf'): File {
  return new File([new Uint8Array(0)], name, { type: 'application/pdf' });
}

function item(overrides: Partial<PreflightItem> = {}): PreflightItem {
  return {
    id: 'pf-0',
    file: fakeFile(),
    status: 'needs_review',
    page: 0,
    pageCount: 1,
    ...overrides,
  };
}

describe('geometrySignature', () => {
  it('distingue por visX/visY/visW/visH', () => {
    const a = [pageGeo({ visW: 612 })];
    const b = [pageGeo({ visW: 500 })];
    expect(geometrySignature(a)).not.toBe(geometrySignature(b));
  });

  it('distingue por rotate', () => {
    const a = [pageGeo({ rotate: 0 })];
    const b = [pageGeo({ rotate: 90 })];
    expect(geometrySignature(a)).not.toBe(geometrySignature(b));
  });

  it('distingue por número de páginas', () => {
    const a = [pageGeo({ page: 0 })];
    const b = [pageGeo({ page: 0 }), pageGeo({ page: 1 })];
    expect(geometrySignature(a)).not.toBe(geometrySignature(b));
  });

  it('es estable frente a ruido de redondeo de coma flotante', () => {
    const a = [pageGeo({ visW: 612.001 })];
    const b = [pageGeo({ visW: 612.0 })];
    expect(geometrySignature(a)).toBe(geometrySignature(b));
  });

  it('dos geometrías realmente distintas dan firmas distintas', () => {
    const a = [pageGeo()];
    const b = [pageGeo({ mediaW: 595.28, mediaH: 841.89, visW: 595.28, visH: 841.89 })];
    expect(geometrySignature(a)).not.toBe(geometrySignature(b));
  });
});

describe('buildPropagationHint', () => {
  const geometry = [pageGeo()];
  const validPlacement = { page: 0, x: 186, y: 40, width: 240, height: 72, rotate: 0 as const };

  it('es null cuando falta placement', () => {
    expect(buildPropagationHint(item({ manual: true, geometry }))).toBeNull();
  });

  it('es null cuando falta geometry', () => {
    expect(buildPropagationHint(item({ manual: true, placement: validPlacement }))).toBeNull();
  });

  it('es null cuando el documento no vino de una colocación manual', () => {
    expect(
      buildPropagationHint(item({ manual: false, placement: validPlacement, geometry })),
    ).toBeNull();
  });

  it('es null cuando no hay geometría para la página del placement', () => {
    const otherPageGeometry = [pageGeo({ page: 1 })];
    expect(
      buildPropagationHint(
        item({ manual: true, placement: validPlacement, geometry: otherPageGeometry }),
      ),
    ).toBeNull();
  });

  it('es null cuando la página está rotada', () => {
    const rotatedGeometry = [pageGeo({ rotate: 90 })];
    expect(
      buildPropagationHint(
        item({ manual: true, placement: validPlacement, geometry: rotatedGeometry }),
      ),
    ).toBeNull();
  });

  /**
   * Hallazgo 5 (QA F2b): `buildPropagationHint` promete `null` en 3 casos en
   * su doc-comment, pero un `item.placement` con un `NaN` de origen (por
   * ejemplo `BoxPlacer` con una división por cero en algún borde de layout)
   * salía como un hint "válido" con `NaN` adentro — nunca validaba sus
   * propios números antes de devolver.
   */
  it('es null cuando el placement trae un NaN (guarda final antes del return)', () => {
    const nanPlacement = { ...validPlacement, x: Number.NaN };
    expect(
      buildPropagationHint(item({ manual: true, placement: nanPlacement, geometry })),
    ).toBeNull();
  });

  it('es null cuando el placement trae un Infinity', () => {
    const infPlacement = { ...validPlacement, width: Number.POSITIVE_INFINITY };
    expect(
      buildPropagationHint(item({ manual: true, placement: infPlacement, geometry })),
    ).toBeNull();
  });

  it('es null cuando el rect canonicalizado sale con boxW/boxH <= 0', () => {
    const zeroWidthPlacement = { ...validPlacement, width: 0 };
    expect(
      buildPropagationHint(item({ manual: true, placement: zeroWidthPlacement, geometry })),
    ).toBeNull();
  });

  it('caso feliz: preferredU/preferredV/boxW/boxH salen del rect confirmado, vía toCanonicalRect', () => {
    const hint = buildPropagationHint(item({ manual: true, placement: validPlacement, geometry }));
    expect(hint).not.toBeNull();

    const expectedCanonical = toCanonicalRect(geometry[0]!, {
      x: validPlacement.x,
      y: validPlacement.y,
      w: validPlacement.width,
      h: validPlacement.height,
    });

    expect(hint).toEqual({
      page: 0,
      preferredU: expectedCanonical.x,
      preferredV: expectedCanonical.y,
      boxW: expectedCanonical.w,
      boxH: expectedCanonical.h,
    });
    // El tamaño propagado es el CONFIRMADO, no el default 240x72 — en este
    // caso feliz coinciden en w/h porque rotate=0 preserva dimensiones, pero
    // lo que importa es que salen del rect, no de una constante.
    expect(hint?.boxW).toBe(validPlacement.width);
    expect(hint?.boxH).toBe(validPlacement.height);
  });
});

describe('propagationCandidates', () => {
  const geometry = [pageGeo()];
  const otherGeometry = [pageGeo({ visW: 500 })];
  const source = item({ id: 'src', status: 'needs_review', geometry });

  it('excluye documentos ready', () => {
    const ready = item({ id: 'ready', status: 'ready', geometry });
    expect(propagationCandidates([source, ready], source)).toEqual([]);
  });

  it('excluye documentos manual (que no sean el source)', () => {
    const manual = item({ id: 'manual', status: 'ready', manual: true, geometry });
    expect(propagationCandidates([source, manual], source)).toEqual([]);
  });

  it('excluye documentos con otra geometrySignature', () => {
    const otherFormat = item({
      id: 'other-format',
      status: 'needs_review',
      geometry: otherGeometry,
    });
    expect(propagationCandidates([source, otherFormat], source)).toEqual([]);
  });

  it('excluye documentos sin geometry', () => {
    const noGeometry = item({ id: 'no-geo', status: 'needs_review' });
    expect(propagationCandidates([source, noGeometry], source)).toEqual([]);
  });

  it('excluye al propio source', () => {
    expect(propagationCandidates([source], source)).toEqual([]);
  });

  it('incluye solo los needs_review con firma idéntica', () => {
    const match1 = item({ id: 'match-1', status: 'needs_review', geometry });
    const match2 = item({ id: 'match-2', status: 'needs_review', geometry });
    const readyNoise = item({ id: 'ready-noise', status: 'ready', geometry });
    const otherFormat = item({
      id: 'other-format',
      status: 'needs_review',
      geometry: otherGeometry,
    });

    const candidates = propagationCandidates(
      [source, match1, match2, readyNoise, otherFormat],
      source,
    );

    expect(candidates.map((c) => c.id).sort()).toEqual(['match-1', 'match-2']);
  });

  it('es [] cuando el source no tiene geometry', () => {
    const noGeoSource = item({ id: 'src-no-geo', status: 'needs_review' });
    const match = item({ id: 'match', status: 'needs_review', geometry });
    expect(propagationCandidates([noGeoSource, match], noGeoSource)).toEqual([]);
  });
});

describe('mergePropagationResult', () => {
  const geometry = [pageGeo()];

  /**
   * El guard anti-downgrade: una segunda pasada de análisis (propagación)
   * NUNCA puede degradar a `unreadable` un documento que la pasada ANTERIOR
   * ya había demostrado legible (`ready`, o `needs_review` con `geometry`).
   * Si eso pasa, es un fallo transitorio del worker en la re-pasada, no una
   * propiedad real del PDF — se conserva el resultado previo tal cual.
   */
  it('conserva un ready previo si la propagación degrada a unreadable', () => {
    const previous = item({ id: 'doc-1', status: 'ready', geometry, source: 'empty-field' });
    const next = item({ id: 'doc-1', status: 'unreadable', reason: 'worker_error' });

    expect(mergePropagationResult(previous, next)).toBe(previous);
  });

  it('conserva un needs_review previo (con geometry) si la propagación degrada a unreadable', () => {
    const previous = item({ id: 'doc-1', status: 'needs_review', geometry });
    const next = item({ id: 'doc-1', status: 'unreadable', reason: 'worker_error' });

    expect(mergePropagationResult(previous, next)).toBe(previous);
  });

  it('acepta el nuevo resultado cuando el previo YA era unreadable (no hay nada que proteger)', () => {
    const previous = item({ id: 'doc-1', status: 'unreadable', reason: 'no_free_slot' });
    const next = item({ id: 'doc-1', status: 'unreadable', reason: 'worker_error' });

    expect(mergePropagationResult(previous, next)).toBe(next);
  });

  it('acepta el nuevo resultado cuando SUMA información (needs_review -> ready)', () => {
    const previous = item({ id: 'doc-1', status: 'needs_review', geometry });
    const next = item({ id: 'doc-1', status: 'ready', geometry, source: 'empty-field' });

    expect(mergePropagationResult(previous, next)).toBe(next);
  });

  it('acepta el nuevo resultado cuando no hay downgrade a unreadable', () => {
    const previous = item({ id: 'doc-1', status: 'needs_review', geometry });
    const next = item({ id: 'doc-1', status: 'needs_review', geometry, reason: 'ambiguous' });

    expect(mergePropagationResult(previous, next)).toBe(next);
  });
});
