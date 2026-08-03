/**
 * propagation.ts — el núcleo puro de la propagación de posición dentro de un
 * lote (F2b).
 *
 * Cuando una persona coloca a mano la firma en UN documento `needs_review`
 * (`FirmarLote.svelte`, colocador manual de F1), y el lote trae varios
 * documentos con el MISMO formato (misma plantilla exportada a PDF, por
 * ejemplo un lote de contratos idénticos salvo el nombre del firmante), esa
 * posición confirmada sirve para el resto sin volver a preguntar.
 *
 * Este módulo no decide NADA por su cuenta: solo construye el hint
 * ({@link buildPropagationHint}) y encuentra a quién podría aplicársele
 * ({@link propagationCandidates}). Aplicarlo de verdad —pasarlo a
 * `analyzeForPreflight`— es F2c; aquí no hay ningún llamador todavía.
 *
 * Puro y sin DOM, igual que `preflight-core.ts`: nada de `File`, nada de red.
 */

import { type PageGeometry, toCanonicalRect } from '@firma-ec/signer';
import type { PreflightItem } from './preflight';

/**
 * El sitio que una persona confirmó a mano en OTRO documento del lote,
 * reducido a lo que `computeAutoPlacement` necesita para reproducirlo:
 * espacio canónico (`preferredV`/`preferredU`, ver `toCanonicalRect`) y el
 * tamaño de caja que la persona confirmó — nunca el default 240×72, porque si
 * lo encogió para un hueco estrecho, ese es el tamaño que hay que propagar.
 */
export interface PropagationHint {
  /** Página 0-based del documento ORIGEN, no del destino. */
  readonly page: number;
  readonly preferredV: number;
  readonly preferredU: number;
  readonly boxW: number;
  readonly boxH: number;
}

/** Un número por su representación redondeada a 1 decimal, para la firma. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Firma de formato de un documento: coincide EXACTAMENTE entre dos
 * documentos que comparten espacio canónico — misma plantilla exportada a
 * PDF, típicamente. No es una heurística de similitud: dos documentos con la
 * misma firma son, a efectos de geometría, el mismo documento.
 *
 * Cada página aporta `mediaW/H/X/Y`, `visX/Y/W/H` y `rotate`, redondeados a 1
 * decimal (absorbe el ruido de coma flotante entre re-exportaciones del mismo
 * origen); el conteo de páginas cierra la firma para que un documento con una
 * página de más o de menos nunca coincida con otro aunque sus páginas
 * compartidas midan igual.
 */
export function geometrySignature(geometry: readonly PageGeometry[]): string {
  const parts: string[] = [];
  for (const geo of geometry) {
    parts.push(
      String(round1(geo.mediaW)),
      String(round1(geo.mediaH)),
      String(round1(geo.mediaX)),
      String(round1(geo.mediaY)),
      String(round1(geo.visX)),
      String(round1(geo.visY)),
      String(round1(geo.visW)),
      String(round1(geo.visH)),
      String(geo.rotate),
    );
  }
  parts.push(String(geometry.length));
  return parts.join('|');
}

/**
 * Construye el hint de propagación a partir de una colocación MANUAL
 * confirmada. `null` (nunca lanza) cuando:
 *   - el documento no tiene `placement`/`geometry` (no se pudo construir el
 *     hint sin ellos), o no vino de una colocación manual;
 *   - no hay geometría para la página donde cayó el `placement`;
 *   - la página está rotada (`geo.rotate !== 0`);
 *   - el rect canonicalizado sale con algún número no finito, o con
 *     `boxW`/`boxH` ≤ 0 — un `item.placement` con un `NaN` de origen (por
 *     ejemplo, una división por cero en algún borde de layout de
 *     `BoxPlacer`) no se propaga como si fuera un hint válido.
 *
 * Atajo deliberado sobre páginas rotadas: la conversión pdf.js↔pdf-lib con
 * `/Rotate` de por medio es una trampa conocida (ver `autoPlacement.ts`) y no
 * está medida sobre un corpus de documentos rotados — revisar cuando exista
 * esa medición.
 *
 * atajo: `placement` llega en el mismo espacio de viewport pdf.js que ya usa
 * el camino de firma manual existente (consistente con el comportamiento de
 * HOY, no es una regresión de este módulo); revisar si ese camino cambia de
 * convención de coordenadas.
 */
export function buildPropagationHint(item: PreflightItem): PropagationHint | null {
  if (item.manual !== true || item.placement === undefined || item.geometry === undefined) {
    return null;
  }

  const { placement, geometry } = item;
  const geo = geometry.find((g) => g.page === placement.page);
  if (!geo) return null;
  if (geo.rotate !== 0) return null;

  const canonical = toCanonicalRect(geo, {
    x: placement.x,
    y: placement.y,
    w: placement.width,
    h: placement.height,
  });

  if (
    !Number.isFinite(canonical.x) ||
    !Number.isFinite(canonical.y) ||
    !Number.isFinite(canonical.w) ||
    !Number.isFinite(canonical.h) ||
    canonical.w <= 0 ||
    canonical.h <= 0
  ) {
    return null;
  }

  return {
    page: placement.page,
    preferredV: canonical.y,
    preferredU: canonical.x,
    boxW: canonical.w,
    boxH: canonical.h,
  };
}

/**
 * Documentos del lote a los que se les podría propagar la posición
 * confirmada en `source`. La garantía no negociable: la propagación NUNCA
 * sobrescribe una posición ya resuelta — solo entran los `needs_review`
 * (nunca un `ready` automático ni otro `manual`), y solo si comparten
 * EXACTAMENTE la firma de formato de `source`.
 *
 * `source` mismo queda excluido de la lista, y si `source.geometry` falta no
 * hay nada contra qué comparar: no hay candidatos.
 */
export function propagationCandidates(
  preflight: readonly PreflightItem[],
  source: PreflightItem,
): PreflightItem[] {
  if (source.geometry === undefined) return [];
  const sourceSignature = geometrySignature(source.geometry);

  return preflight.filter((item) => {
    if (item === source) return false;
    if (item.status !== 'needs_review') return false;
    if (item.geometry === undefined) return false;
    return geometrySignature(item.geometry) === sourceSignature;
  });
}

/**
 * Fusiona el resultado NUEVO de una propagación (`next`) con el item VIEJO
 * que ya estaba en preflight (`previous`), para el mismo documento.
 *
 * Guarda anti-downgrade: la propagación puede SUMAR información (un
 * `needs_review` que pasa a `ready`), nunca destruirla. Si el análisis nuevo
 * degrada a `unreadable` un documento que el análisis anterior ya tenía en
 * otro estado (`ready`, o `needs_review` con `geometry` — es decir, ya
 * demostrado legible), eso es un fallo transitorio del worker en esta segunda
 * pasada, no una propiedad real del PDF: se conserva `previous` tal cual.
 */
export function mergePropagationResult(
  previous: PreflightItem,
  next: PreflightItem,
): PreflightItem {
  if (next.status === 'unreadable' && previous.status !== 'unreadable') return previous;
  return next;
}
