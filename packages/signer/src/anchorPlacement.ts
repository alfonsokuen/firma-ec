/**
 * anchorPlacement.ts — de los HITS sueltos de `anchorMatch.ts` a UN sitio
 * preferido, en el mismo espacio canónico que usa `enumerateSlots`
 * (`autoPlacement.ts`).
 *
 * Agrupa hits en BLOQUES (líneas contiguas ≤ `BLOCK_GAP_PT`, la misma
 * constante que usa `reservedGapV` para el bloque de firma) y rankea:
 * personalizado (nombre/cédula) antes que etiqueta genérica; a igualdad, el
 * bloque más bajo de la página más tardía — el nombre citado en una cláusula
 * de la página 2 queda arriba; el bloque de firma de la última página, abajo.
 *
 * Como en `autoPlacement.ts`, el resultado es MATERIA PRIMA: solo dice dónde
 * PREFERIRÍA caer la estampa. Quien decide si de verdad cabe ahí —contra
 * firmas previas y texto— es `enumerateSlots`, no este módulo.
 */

import type { AnchorHit, AnchorKind } from './anchorMatch.js';
import { BLOCK_GAP_PT, EDGE_MARGIN, GAP, orientedDims, toCanonical } from './autoPlacement.js';
import type { PageGeometry } from './pageGeometry.js';

/**
 * Motivo por el que un ancla elegida es dudosa, calculado aquí porque solo
 * este módulo ve el conjunto COMPLETO de anclas de la página (cuántos
 * bloques "Firma" hay, si alguno tiene nombre/cédula al lado).
 */
export type AnchorSignal = 'ancla_ambigua';

/** Sitio preferido, ya en espacio canónico, listo para `enumerateSlots`. */
export interface AnchorChoice {
  readonly page: number;
  readonly preferredV: number;
  readonly preferredU?: number;
  readonly kind: AnchorKind;
  /** `true` para `firmante-nombre`/`firmante-cedula`; `false` para `firma-label`. */
  readonly personalized: boolean;
  readonly signals: readonly AnchorSignal[];
}

interface CanonicalHit {
  page: number;
  kind: AnchorKind;
  v: number;
  u: number;
  h: number;
}

interface Block {
  page: number;
  kinds: Set<AnchorKind>;
  /** Borde superior del bloque (v + h de su línea más alta). Es donde se ancla `preferredV`, igual que `reservedGapV`. */
  topV: number;
  /** Borde inferior del bloque — "qué tan bajo" está, para el desempate por página. */
  bottomV: number;
  /** `u` de la línea más baja vista del bloque: el margen izquierdo del nombre impreso. */
  u: number;
}

function personalizedKindOf(kinds: ReadonlySet<AnchorKind>): AnchorKind | null {
  if (kinds.has('firmante-cedula')) return 'firmante-cedula';
  if (kinds.has('firmante-nombre')) return 'firmante-nombre';
  return null;
}

/** Agrupa hits YA canonicalizados en bloques por página: líneas a ≤ `BLOCK_GAP_PT` una de otra son el MISMO bloque. */
function groupIntoBlocks(hits: readonly CanonicalHit[]): Block[] {
  const byPage = new Map<number, CanonicalHit[]>();
  for (const hit of hits) {
    const list = byPage.get(hit.page) ?? [];
    list.push(hit);
    byPage.set(hit.page, list);
  }

  const blocks: Block[] = [];
  for (const [page, list] of byPage) {
    const sorted = [...list].sort((a, b) => a.v - b.v);
    let current: Block | null = null;
    for (const hit of sorted) {
      if (current && hit.v - current.topV <= BLOCK_GAP_PT) {
        current.kinds.add(hit.kind);
        current.topV = Math.max(current.topV, hit.v + hit.h);
        current.u = hit.u;
      } else {
        current = {
          page,
          kinds: new Set([hit.kind]),
          topV: hit.v + hit.h,
          bottomV: hit.v,
          u: hit.u,
        };
        blocks.push(current);
      }
    }
  }
  return blocks;
}

/**
 * Reduce todas las anclas encontradas a UN sitio preferido, o `undefined` si
 * no hubo ni una. Nunca lanza: geometría faltante para la página de un hit
 * simplemente descarta ESE hit, no la función entera.
 */
export function computeAnchorPlacement(
  hits: readonly AnchorHit[],
  geometry: readonly PageGeometry[],
): AnchorChoice | undefined {
  if (hits.length === 0) return undefined;
  const geoByPage = new Map(geometry.map((g) => [g.page, g]));

  const canonical: CanonicalHit[] = [];
  for (const hit of hits) {
    const geo = geoByPage.get(hit.page);
    if (!geo) continue;
    const c = toCanonical(geo, hit.x ?? 0, hit.y);
    canonical.push({ page: hit.page, kind: hit.kind, v: c.v, u: c.u, h: hit.h });
  }
  if (canonical.length === 0) return undefined;

  const blocks = groupIntoBlocks(canonical);
  const personalizedHitExists = canonical.some((h) => h.kind !== 'firma-label');

  const ranked = [...blocks].sort((a, b) => {
    const aPersonalized = personalizedKindOf(a.kinds) !== null;
    const bPersonalized = personalizedKindOf(b.kinds) !== null;
    if (aPersonalized !== bPersonalized) return aPersonalized ? -1 : 1;
    if (a.page !== b.page) return b.page - a.page; // página más tardía primero
    return a.bottomV - b.bottomV; // bloque más bajo (más cerca del pie) primero
  });

  const chosen = ranked[0];
  if (!chosen) return undefined;

  const chosenKind = personalizedKindOf(chosen.kinds) ?? 'firma-label';
  const personalized = chosenKind !== 'firma-label';

  // `ancla_ambigua`: dos (o más) bloques "Firma" genéricos en la misma página
  // que la elegida, y NI UNA ancla personalizada en todo el documento — un
  // contrato bipartito donde no hay forma de saber cuál "Firma:" es la
  // nuestra. Con al menos una ancla personalizada en algún sitio, aunque no
  // sea la elegida, ya no es ambiguo: hay evidencia de a quién pertenece cada
  // bloque.
  const signals: AnchorSignal[] = [];
  if (!personalized) {
    const genericBlocksOnSamePage = blocks.filter(
      (b) => b.page === chosen.page && personalizedKindOf(b.kinds) === null,
    ).length;
    if (!personalizedHitExists && genericBlocksOnSamePage >= 2) signals.push('ancla_ambigua');
  }

  const geo = geoByPage.get(chosen.page)!;
  const { w: orientedW } = orientedDims(geo);
  const preferredU = Math.max(EDGE_MARGIN, Math.min(chosen.u, orientedW - EDGE_MARGIN));

  return {
    page: chosen.page,
    // Mismo criterio que `reservedGapV`: el hueco va justo ENCIMA del
    // bloque, con la misma holgura media.
    preferredV: chosen.topV + GAP * 0.5,
    preferredU,
    kind: chosenKind,
    personalized,
    signals,
  };
}

// Guardia de tipos — ver `anchorMatch.ts`. `AnchorSignal`/`AnchorKind` son
// uniones cerradas, no fugas; un campo `string` plano SÍ rompería `tsc`.
type AssertNoStringFields<T> = { [K in keyof T]: string extends T[K] ? never : T[K] };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _typeGuardNoStringLeak(
  choice: AssertNoStringFields<AnchorChoice>,
): AssertNoStringFields<AnchorChoice> {
  return choice;
}
