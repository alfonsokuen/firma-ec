/**
 * anchorPlacement.test.ts — ranking (personalizado > genérico, bloque más
 * bajo de la página más tardía), bloque de firma vs mención en una cláusula,
 * la señal `ancla_ambigua`, y el caso MULTIFIRMA de la parte D del diseño:
 * un documento YA firmado necesita una 2ª firma y el anti-solape debe
 * colocarla JUNTO a la primera, no al pie.
 */
import { describe, expect, it } from 'vitest';

import type { AnchorHit } from '../src/anchorMatch.js';
import { computeAnchorPlacement } from '../src/anchorPlacement.js';
import {
  type AnchorPlacementHint,
  type ExistingSigRect,
  GAP,
  computeAutoPlacement,
} from '../src/autoPlacement.js';
import type { PageGeometry } from '../src/pageGeometry.js';

/** Página A4-ish sin rotar, sin margen entre MediaBox y área visible — así el espacio canónico coincide con el PDF crudo. */
function geo(page: number, w = 612, h = 792): PageGeometry {
  return {
    page,
    mediaW: w,
    mediaH: h,
    mediaX: 0,
    mediaY: 0,
    visX: 0,
    visY: 0,
    visW: w,
    visH: h,
    rotate: 0,
  };
}

function hit(page: number, kind: AnchorHit['kind'], x: number, y: number, h = 12): AnchorHit {
  return { page, kind, x, y, h };
}

describe('ranking: personalizado antes que genérico', () => {
  it('con un "firma-label" y un "firmante-nombre" en la misma página, gana el nombre', () => {
    const hits: AnchorHit[] = [hit(0, 'firma-label', 50, 50), hit(0, 'firmante-nombre', 50, 100)];
    const choice = computeAnchorPlacement(hits, [geo(0)]);
    expect(choice?.kind).toBe('firmante-nombre');
    expect(choice?.personalized).toBe(true);
  });

  it('la cédula también le gana a la etiqueta genérica', () => {
    const hits: AnchorHit[] = [hit(0, 'firma-label', 50, 50), hit(0, 'firmante-cedula', 50, 200)];
    const choice = computeAnchorPlacement(hits, [geo(0)]);
    expect(choice?.kind).toBe('firmante-cedula');
  });
});

describe('ranking: página más tardía, luego bloque más bajo', () => {
  it('entre dos páginas con anclas personalizadas, gana la página posterior', () => {
    const hits: AnchorHit[] = [
      hit(0, 'firmante-nombre', 50, 100),
      hit(2, 'firmante-nombre', 50, 100),
    ];
    const choice = computeAnchorPlacement(hits, [geo(0), geo(1), geo(2)]);
    expect(choice?.page).toBe(2);
  });

  it('bloque de firma (cerca del pie) vs mención en una cláusula (media página): gana el más bajo', () => {
    // El nombre citado a media página (y=400, lejos del pie) no debe ganarle
    // al bloque de firma real, pegado abajo (y=40).
    const hits: AnchorHit[] = [
      hit(0, 'firmante-nombre', 50, 400), // mención en cláusula
      hit(0, 'firmante-nombre', 50, 40), // bloque de firma real
    ];
    const choice = computeAnchorPlacement(hits, [geo(0)]);
    // preferredV = topV(bloque elegido) + GAP/2; el bloque de y=40 (h=12) da
    // topV=52, muy por debajo del de y=400 (topV=412).
    expect(choice?.preferredV).toBeCloseTo(40 + 12 + GAP * 0.5, 5);
  });
});

describe('ancla_ambigua', () => {
  it('dos "Firma" genéricas en la misma página y NINGÚN dato personalizado ⇒ ancla_ambigua', () => {
    // En bloques DISTINTOS (separados más de BLOCK_GAP_PT): dos zonas de firma
    // reales, no dos líneas de la misma. Un contrato bipartito típico.
    const hits: AnchorHit[] = [hit(0, 'firma-label', 50, 50), hit(0, 'firma-label', 400, 500)];
    const choice = computeAnchorPlacement(hits, [geo(0)]);
    expect(choice?.kind).toBe('firma-label');
    expect(choice?.signals).toContain('ancla_ambigua');
  });

  it('con UNA sola "Firma" genérica en la página, no es ambiguo (no hay con qué confundirla)', () => {
    const hits: AnchorHit[] = [hit(0, 'firma-label', 50, 50)];
    const choice = computeAnchorPlacement(hits, [geo(0)]);
    expect(choice?.signals).not.toContain('ancla_ambigua');
  });

  it('con dos "Firma" pero TAMBIÉN una ancla personalizada en el documento, deja de ser ambiguo', () => {
    const hits: AnchorHit[] = [
      hit(0, 'firma-label', 50, 50),
      hit(0, 'firma-label', 400, 500),
      hit(1, 'firmante-nombre', 50, 100),
    ];
    const choice = computeAnchorPlacement(hits, [geo(0), geo(1)]);
    // Gana la personalizada (página más tardía + personalizada > genérica).
    expect(choice?.kind).toBe('firmante-nombre');
  });
});

describe('sin anclas', () => {
  it('un array vacío no produce elección', () => {
    expect(computeAnchorPlacement([], [geo(0)])).toBeUndefined();
  });

  it('anclas en páginas sin geometría conocida se descartan, no revientan', () => {
    const hits: AnchorHit[] = [hit(5, 'firma-label', 50, 50)];
    expect(computeAnchorPlacement(hits, [geo(0)])).toBeUndefined();
  });
});

describe('parte D — multifirma: la 2ª firma cae JUNTO a la 1ª, no al pie', () => {
  const boxW = 240;
  const boxH = 72;
  // Página angosta A PROPÓSITO: en una A4 normal (612pt) el cuadro de 240pt
  // cabe AL LADO de la firma existente sin ningún ancla, lo que enmascara el
  // defecto D4 (el propio motivo del fix). A 300pt no hay hueco horizontal:
  // el anti-solape queda forzado a razonar en VERTICAL, que es donde vivía
  // el bug medido sobre el corpus real (CONTRATO HORACIO MAFLA).
  function narrowGeo(): PageGeometry {
    return {
      page: 0,
      mediaW: 300,
      mediaH: 792,
      mediaX: 0,
      mediaY: 0,
      visX: 0,
      visY: 0,
      visW: 300,
      visH: 792,
      rotate: 0,
    };
  }

  it('sin ancla (comportamiento de siempre): sin pista de dónde iba la firma, no encuentra hueco vertical', () => {
    const geometry = [narrowGeo()];
    const existing: ExistingSigRect[] = [{ page: 0, x: 20, y: 550, w: 200, h: 150 }];
    const placement = computeAutoPlacement({ geometry, existing, boxW, boxH });
    // Este es EXACTAMENTE el defecto D4 que motiva la parte D: el barrido de
    // abajo arriba, anclado en el borde inferior de la firma existente, no
    // encuentra ningún hueco vertical libre en una página angosta — el
    // documento se aparta cuando SÍ había sitio justo debajo del bloque de
    // firma, si alguien hubiera sabido mirar ahí.
    expect(placement.status).toBe('needs_review');
  });

  it('con el ancla del nombre del firmante justo debajo de la 1ª firma, la 2ª aterriza AHÍ', () => {
    const geometry = [narrowGeo()];
    // La 1ª firma ocupa el canónico y=550..700. El nombre impreso del
    // firmante está justo debajo, en y=450 (con margen de sobra para los
    // 72pt de alto de la estampa + el GAP).
    const existing: ExistingSigRect[] = [{ page: 0, x: 20, y: 550, w: 200, h: 150 }];
    const anchor: AnchorPlacementHint = {
      page: 0,
      preferredV: 450,
      preferredU: 20,
      kind: 'firmante-nombre',
    };
    const placement = computeAutoPlacement({ geometry, existing, boxW, boxH, anchor });
    expect(placement.status).toBe('ok');
    if (placement.status === 'ok') {
      expect(placement.source).toBe('text-anchor');
      expect(placement.y).toBeCloseTo(450, 1); // exactamente donde señaló el ancla
      expect(placement.y).toBeGreaterThan(400); // y NO al pie de la página (y=18)
    }
  });

  it('si el sitio del ancla está ocupado, cae al pipeline normal — nunca se cuela encima de otra firma', () => {
    const geometry = [narrowGeo()];
    const existing: ExistingSigRect[] = [
      { page: 0, x: 20, y: 550, w: 200, h: 150 },
      // Una 2ª firma YA ocupa TODO el ancho a la altura que señalaría el
      // ancla: no queda hueco horizontal para esquivarla.
      { page: 0, x: 0, y: 420, w: 300, h: 90 },
    ];
    const anchor: AnchorPlacementHint = {
      page: 0,
      preferredV: 450,
      preferredU: 20,
      kind: 'firmante-nombre',
    };
    const placement = computeAutoPlacement({ geometry, existing, boxW, boxH, anchor });
    expect(placement.status).toBe('ok');
    if (placement.status === 'ok') {
      // El ancla NO se honró (si se hubiera honrado, source sería 'text-anchor').
      expect(placement.source).not.toBe('text-anchor');
      // Y sobre todo: nunca se estampó encima de ninguna de las dos firmas.
      const overlapsFirst = placement.y < 700 && placement.y + placement.h > 550;
      const overlapsSecond = placement.y < 510 && placement.y + placement.h > 420;
      expect(overlapsFirst).toBe(false);
      expect(overlapsSecond).toBe(false);
    }
  });
});
