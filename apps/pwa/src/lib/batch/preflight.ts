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
 * Lo que NO reproduce es el cruce adicional del worker contra
 * `detectSignatures` (`sign-session.worker.ts` →
 * `empty_field_conflicts_with_prior_signature`): un documento con esa
 * contradicción sale 'ready' aquí y el worker lo aparta después. Se prefiere
 * ese sentido del error —prometer de menos, nunca de más— antes que duplicar
 * aquí una segunda lectura completa del PDF por documento.
 *
 * Privacidad: no registra nada. El nombre de un documento es dato del usuario y
 * no sale de la pantalla — ni a consola, ni a un `Error`, ni a la red.
 */

import {
  type AutoPlacement,
  analyzePdfForPlacement,
  computeAutoPlacement,
} from '@firma-ec/signer';
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

/** Resuelve dónde caería la estampa en UN documento. No lanza: todo fallo es un estado. */
async function preflightOne(file: File, id: string): Promise<PreflightItem> {
  let analysis: Awaited<ReturnType<typeof analyzePdfForPlacement>>;
  try {
    analysis = await analyzePdfForPlacement(new Uint8Array(await file.arrayBuffer()));
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
    return {
      id,
      file,
      status: 'ready',
      page: placement.page,
      pageCount,
      source: placement.source,
    };
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
