/**
 * preflight.ts — revisión de colocación ANTES de pedir el PIN.
 *
 * El motor de lotes resuelve la colocación automática mientras firma, y aparta
 * con `needs_review` el documento cuyo rect no es defendible. Descubrirlo en ese
 * momento es tarde: el PIN ya se pidió y el lote ya corrió. Este módulo hace el
 * MISMO cálculo antes, con el PDF solo, para que la persona vea qué documentos
 * van a quedarse fuera cuando todavía puede quitarlos o firmarlos a mano.
 *
 * Comparte el NÚCLEO con el worker: llama a `analyzePdfForPlacement` y
 * `computeAutoPlacement` de `@firma-ec/signer`, las mismas funciones que el
 * worker ejecuta después, así que el criterio de colocación no puede divergir.
 *
 * Reproduce TAMBIÉN el cruce del worker contra `detectSignatures`
 * (`empty_field_conflicts_with_prior_signature`), pero solo cuando puede
 * importar: la contradicción únicamente existe si la fuente elegida es
 * `empty-field`, así que la segunda lectura del PDF se paga en esa minoría de
 * documentos y no en todo el lote.
 *
 * Ese cruce dejó de ser opcional al empezar a EXPORTAR el rect
 * ({@link PreflightItem.placement}): si el llamante lo manda al firmante, el
 * worker ya no analiza nada y sus guardas no llegan a correr. De ahí la regla
 * de este módulo: el rect solo se publica cuando el pre-vuelo ha reproducido la
 * decisión del worker ENTERA. Ante cualquier duda no se publica, el documento
 * cae a colocación automática, y el worker vuelve a ser quien manda.
 *
 * Privacidad: no registra nada. El nombre de un documento es dato del usuario y
 * no sale de la pantalla — ni a consola, ni a un `Error`, ni a la red.
 */

import {
  type AutoPlacement,
  analyzePdfForPlacement,
  computeAutoPlacement,
  detectSignatures,
} from '@firma-ec/signer';
import type { SignVisibleSigInput } from '../workers/sign-bus';
import { MAX_BATCH_FILES, MAX_BATCH_FILE_SIZE_BYTES } from '../workers/sign-queue';

/**
 * Techo de producto para v1. El motor admite {@link MAX_BATCH_FILES}, pero 200
 * documentos son ~25 minutos con la pestaña abierta y una sola oportunidad de
 * que algo salga mal. Subir este número es una línea.
 */
export const BATCH_UI_MAX_FILES = 50;

/** Nunca por encima de lo que el motor acepta, pase lo que pase con la constante de arriba. */
export const EFFECTIVE_MAX_FILES = Math.min(BATCH_UI_MAX_FILES, MAX_BATCH_FILES);

/** Cómo eligió el motor el sitio de la estampa, cuando lo encontró. */
export type PlacementSource = Extract<AutoPlacement, { status: 'ok' }>['source'];

export type PreflightStatus =
  /** La firma tiene un sitio defendible en este documento. */
  | 'ready'
  /** Se firmará solo si una persona coloca la firma a mano. */
  | 'needs_review'
  /** El PDF no se pudo leer (cifrado o corrupto): no hay nada que colocar. */
  | 'unreadable';

export interface PreflightItem {
  readonly id: string;
  readonly file: File;
  readonly status: PreflightStatus;
  /**
   * Página donde caerá (o debería caer) la estampa, **base 0**, tal como la
   * reporta el motor. Se conserva sin convertir para que comparar con
   * `BatchQueueItem.needsReview.page` no exija recordar un desfase; quien la
   * pinte suma 1.
   */
  readonly page: number;
  /** Total de páginas, `0` si el documento no se pudo abrir. */
  readonly pageCount: number;
  /** Motivo estable, presente salvo cuando `status` es `'ready'`. */
  readonly reason?: string;
  /** Cómo se eligió el sitio: campo de firma declarado, esquiva, o pie por defecto. */
  readonly source?: PlacementSource;
  /**
   * El rect exacto que se calculó aquí, listo para mandarlo al firmante y
   * ahorrarle repetir el análisis (ver {@link placementOverrides}).
   *
   * Presente SOLO cuando el pre-vuelo reprodujo la decisión del worker entera.
   * Su ausencia en un documento `ready` no es un error: significa «que lo
   * decida el worker», que es el camino de siempre.
   */
  readonly placement?: SignVisibleSigInput;
}

export interface PreflightReport {
  readonly items: PreflightItem[];
  readonly ready: number;
  readonly needsReview: number;
  readonly unreadable: number;
}

export type RejectionReason = 'too_many' | 'not_pdf' | 'file_too_large' | 'empty';

export interface RejectedFile {
  readonly file: File;
  readonly reason: RejectionReason;
}

export interface AcceptResult {
  readonly accepted: File[];
  readonly rejected: RejectedFile[];
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

/**
 * Filtra lo que se puede firmar y NOMBRA por qué se cae cada descarte. Un
 * archivo que desaparece en silencio de la lista es peor que uno rechazado: la
 * persona cree que va en el lote y no va.
 *
 * `alreadyPicked` es el número de documentos que ya están en la lista, para que
 * el tope cuente el total y no cada tanda por separado.
 */
export function acceptFiles(incoming: readonly File[], alreadyPicked = 0): AcceptResult {
  const accepted: File[] = [];
  const rejected: RejectedFile[] = [];

  for (const file of incoming) {
    if (!isPdf(file)) {
      rejected.push({ file, reason: 'not_pdf' });
    } else if (file.size === 0) {
      rejected.push({ file, reason: 'empty' });
    } else if (file.size > MAX_BATCH_FILE_SIZE_BYTES) {
      rejected.push({ file, reason: 'file_too_large' });
    } else if (alreadyPicked + accepted.length >= EFFECTIVE_MAX_FILES) {
      rejected.push({ file, reason: 'too_many' });
    } else {
      accepted.push(file);
    }
  }

  return { accepted, rejected };
}

export interface PreflightOptions {
  /** Se dispara al resolver cada documento, para pintar la lista mientras avanza. */
  onItem?: (item: PreflightItem, index: number) => void;
  signal?: AbortSignal;
  /**
   * Distingue los ids de esta corrida de los de cualquier otra. Sin él, dos
   * revisiones consecutivas emitían el mismo `pf-0`, `pf-1`… y la lista acababa
   * con claves duplicadas mezclando documentos de ambas.
   */
  runId?: string;
}

/**
 * Traduce el rect del motor (`w`/`h`) al que viaja al worker (`width`/`height`).
 * Los dos nombres existen y no se pueden unificar sin tocar el protocolo, así
 * que la conversión vive en un solo sitio en vez de repetirse.
 */
function toVisibleSig(placement: Extract<AutoPlacement, { status: 'ok' }>): SignVisibleSigInput {
  return {
    page: placement.page,
    x: placement.x,
    y: placement.y,
    width: placement.w,
    height: placement.h,
    rotate: placement.rotate,
  };
}

/** Resuelve dónde caería la estampa en UN documento. No lanza: todo fallo es un estado. */
async function preflightOne(file: File, id: string): Promise<PreflightItem> {
  let analysis: Awaited<ReturnType<typeof analyzePdfForPlacement>>;
  let pdfBytes: Uint8Array;
  try {
    // Los bytes se conservan: el cruce contra `detectSignatures` los reutiliza
    // sin volver a leer el fichero, igual que hace el worker.
    pdfBytes = new Uint8Array(await file.arrayBuffer());
    analysis = await analyzePdfForPlacement(pdfBytes);
  } catch {
    // Ni siquiera se pudo leer el archivo del disco. Es un estado del documento,
    // no una excepción del lote: los otros 49 siguen siendo firmables.
    return { id, file, status: 'unreadable', page: 1, pageCount: 0, reason: 'unreadable' };
  }

  const placement = computeAutoPlacement({
    geometry: analysis.geometry,
    existing: analysis.existing,
    emptySigFields: analysis.emptySigFields,
    textBands: analysis.textBands,
    unanalyzedPages: analysis.unanalyzedPages,
    ...(analysis.failure ? { failure: analysis.failure } : {}),
  });

  const pageCount = analysis.geometry.length;

  if (placement.status === 'ok') {
    const ready = {
      id,
      file,
      status: 'ready',
      page: placement.page,
      pageCount,
      source: placement.source,
    } as const;

    // Mismo cruce que el worker: si `detectSignatures` ve firmas previas que el
    // análisis no vio, lo que este llama «campo de firma vacío» bien puede ser
    // la firma anterior — y como `empty-field` gana sobre todo lo demás, la
    // estampa acabaría con el rect EXACTO de la firma existente, encima, y el
    // lote lo contaría como éxito limpio.
    //
    // Solo se paga en los documentos con esa fuente: en cualquier otra, la
    // contradicción no puede darse.
    if (placement.source !== 'empty-field') {
      return { ...ready, placement: toVisibleSig(placement) };
    }

    let prior: Awaited<ReturnType<typeof detectSignatures>>;
    try {
      prior = await detectSignatures(pdfBytes);
    } catch {
      // No se pudo comprobar. El documento no se aparta —el análisis sí lo leyó,
      // así que es legible— pero tampoco se publica su rect: sin él cae a
      // colocación automática y el worker rehace el cruce con sus propias
      // guardas. Se pierde el ahorro, nunca la comprobación.
      return ready;
    }

    if (prior.length > 0 && analysis.existing.length === 0) {
      return {
        id,
        file,
        status: 'needs_review',
        page: placement.page,
        pageCount,
        reason: 'empty_field_conflicts_with_prior_signature',
      };
    }

    return { ...ready, placement: toVisibleSig(placement) };
  }

  // Un documento ilegible y uno legible sin sitio para la firma son problemas
  // distintos y se arreglan distinto — no se colapsan en un solo estado.
  return {
    id,
    file,
    status: analysis.failure ? 'unreadable' : 'needs_review',
    page: placement.page,
    pageCount,
    reason: analysis.failure ?? placement.reason,
  };
}

/**
 * Revisa el lote entero, documento a documento, informando del avance. Se puede
 * abortar: al soltar `signal`, devuelve lo resuelto hasta ese punto en vez de
 * dejar a la pantalla esperando un informe que ya nadie quiere.
 */
/**
 * Convierte los rects ya calculados en el mapa que espera
 * `BatchSignOptions.visibleSigByIndex`, para que el firmante no repita el
 * análisis que esta pantalla acaba de hacer.
 *
 * ⚠️ La clave es la POSICIÓN dentro de `items`, así que hay que pasar el MISMO
 * array del que sale la lista de ficheros del lote. Pasar uno filtrado de otra
 * manera desplaza los rects y estampa en un documento el sitio calculado para
 * otro — el peor fallo de este módulo, y silencioso.
 *
 * Un documento sin rect publicado simplemente no entra en el mapa: cae a la
 * colocación automática del worker, que es el camino de siempre.
 */
export function placementOverrides(
  items: readonly PreflightItem[],
): ReadonlyMap<number, SignVisibleSigInput> {
  const overrides = new Map<number, SignVisibleSigInput>();
  for (const [index, item] of items.entries()) {
    if (item.placement !== undefined) overrides.set(index, item.placement);
  }
  return overrides;
}

export async function preflightBatch(
  files: readonly File[],
  opts: PreflightOptions = {},
): Promise<PreflightReport> {
  const items: PreflightItem[] = [];

  for (const [index, file] of files.entries()) {
    if (opts.signal?.aborted) break;
    const item = await preflightOne(file, `${opts.runId ?? 'pf'}-${index}`);
    items.push(item);
    opts.onItem?.(item, index);
  }

  return {
    items,
    ready: items.filter((i) => i.status === 'ready').length,
    needsReview: items.filter((i) => i.status === 'needs_review').length,
    unreadable: items.filter((i) => i.status === 'unreadable').length,
  };
}
