/**
 * preflight.ts — revisión de colocación ANTES de pedir el PIN.
 *
 * El motor de lotes resuelve la colocación automática mientras firma, y aparta
 * con `needs_review` el documento cuyo rect no es defendible. Descubrirlo en ese
 * momento es tarde: el PIN ya se pidió y el lote ya corrió. Este módulo hace el
 * MISMO cálculo antes, con el PDF solo, para que la persona vea qué documentos
 * van a quedarse fuera cuando todavía puede quitarlos o firmarlos a mano.
 *
 * El análisis en sí vive en `preflight-core.ts` (`analyzeForPreflight`), y
 * corre en un Web Worker (`preflight.worker.ts`, vía `preflight-bus.ts`) —
 * NO en el hilo principal. Con PDFs grandes, `analyzeForPreflight` puede tardar
 * segundos; hacerlo aquí bloqueaba la UI del navegador mientras el lote entero
 * se revisaba, uno tras otro. Este módulo solo lee los bytes del `File`
 * (I/O async, no bloquea) y orquesta el lote contra UNA sesión de worker
 * reutilizada para todos los documentos — abrir un worker por documento
 * pagaría el arranque del chunk de `@firma-ec/signer` N veces. El núcleo llama
 * a `analyzePdfForPlacement` y `computeAutoPlacement` de `@firma-ec/signer`,
 * las mismas funciones que el worker de firma ejecuta después, así que el
 * criterio de colocación no puede divergir.
 *
 * El núcleo reproduce TAMBIÉN el cruce contra `detectSignatures`
 * (`empty_field_conflicts_with_prior_signature`), pero solo cuando puede
 * importar: la contradicción únicamente existe si la fuente elegida es
 * `empty-field`, así que la segunda lectura del PDF se paga en esa minoría de
 * documentos y no en todo el lote.
 *
 * Ese cruce dejó de ser opcional al empezar a EXPORTAR el rect
 * ({@link PreflightItem.placement}): si el llamante lo manda al firmante, el
 * worker de firma ya no analiza nada y sus guardas no llegan a correr. De ahí
 * la regla de este módulo: el rect solo se publica cuando el pre-vuelo ha
 * reproducido la decisión del worker de firma ENTERA. Ante cualquier duda no
 * se publica, el documento cae a colocación automática, y el worker de firma
 * vuelve a ser quien manda.
 *
 * Privacidad: no registra nada. El nombre de un documento es dato del usuario y
 * no sale de la pantalla — ni a consola, ni a un `Error`, ni a la red. El
 * worker de análisis solo recibe bytes, nunca el nombre del archivo.
 */

import type { AutoPlacement } from '@firma-ec/signer';
import type { SignVisibleSigInput } from '../workers/sign-bus';
import { MAX_BATCH_FILES, MAX_BATCH_FILE_SIZE_BYTES } from '../workers/sign-queue';
import {
  PreflightAnalysisTimeoutError,
  type PreflightSession,
  openPreflightSession,
} from './preflight-bus';

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
   * ahorrarle repetir el análisis (ver {@link toBatchInput}).
   *
   * Presente SOLO cuando el pre-vuelo reprodujo la decisión del worker entera.
   * Su ausencia en un documento `ready` no es un error: significa «que lo
   * decida el worker», que es el camino de siempre.
   */
  readonly placement?: SignVisibleSigInput;
  /**
   * `true` cuando `placement` no vino del análisis automático sino de que una
   * persona lo colocó a mano en el colocador manual del lote (F1 fase B). Solo
   * tiene sentido junto a `status: 'ready'`. Sirve para distinguir en la lista
   * "Listo para firmar" (automático) de "Colocada a mano" — ambos firman igual,
   * pero la persona quiere saber cuál revisó ella misma.
   */
  readonly manual?: boolean;
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
 * Resuelve dónde caería la estampa en UN documento, usando la sesión de
 * worker ya abierta. No lanza: todo fallo es un estado.
 *
 * La lectura del `File` se queda en el hilo principal — es I/O async, no
 * bloquea, y así el mapeo de "archivo no se pudo leer" no cambia. Solo el
 * análisis (`analyzeForPreflight`, potencialmente lento) corre en el worker.
 */
async function preflightOne(
  file: File,
  id: string,
  session: PreflightSession,
): Promise<PreflightItem> {
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    // Ni siquiera se pudo leer el archivo del disco. Es un estado del documento,
    // no una excepción del lote: los otros 49 siguen siendo firmables.
    return { id, file, status: 'unreadable', page: 1, pageCount: 0, reason: 'unreadable' };
  }

  try {
    const outcome = await session.analyze(pdfBytes);
    return { id, file, ...outcome };
  } catch (e) {
    if (e instanceof PreflightAnalysisTimeoutError) {
      // El worker se mató a sí mismo al vencer el tiempo — el documento no se
      // determinó ilegible, simplemente el análisis no terminó a tiempo.
      // Distinto de 'unreadable' para que la razón mostrada sea honesta.
      return {
        id,
        file,
        status: 'needs_review',
        page: 0,
        pageCount: 0,
        reason: 'analysis_timeout',
      };
    }
    // Red de seguridad: la excepción llegó del worker (su propio try/catch de
    // último recurso, o un fallo de protocolo). No es un `needs_review` — no
    // se pudo determinar nada del documento, igual que un `File` que no se
    // pudo leer.
    return { id, file, status: 'unreadable', page: 1, pageCount: 0, reason: 'unreadable' };
  }
}

/**
 * Revisa el lote entero, documento a documento, informando del avance. Se puede
 * abortar: al soltar `signal`, devuelve lo resuelto hasta ese punto en vez de
 * dejar a la pantalla esperando un informe que ya nadie quiere.
 */
/** La lista de ficheros del lote y sus rects, atados. */
export interface BatchSignInput {
  readonly files: File[];
  /** Rects por POSICIÓN dentro de `files`. Ver {@link toBatchInput}. */
  readonly visibleSigByIndex: ReadonlyMap<number, SignVisibleSigInput>;
}

/**
 * Prepara de una vez los dos datos que el firmante necesita: qué ficheros van
 * en el lote y dónde va la estampa de cada uno.
 *
 * Van juntos a propósito. La clave del mapa es la posición dentro de `files`, y
 * cuando eran dos llamadas separadas nada impedía que una lista se filtrara y
 * la otra no: cada documento se firmaría con el rect calculado para su vecino,
 * todos saldrían `done` y el ZIP llegaría completo. El peor fallo de este
 * módulo y, además, mudo. Aquí el índice se deriva de `files` mientras se
 * construye, así que la desalineación deja de ser posible en vez de quedar
 * prohibida por un comentario.
 *
 * Un documento sin rect publicado simplemente no entra en el mapa: cae a la
 * colocación automática del worker, que es el camino de siempre.
 */
export function toBatchInput(items: readonly PreflightItem[]): BatchSignInput {
  const files: File[] = [];
  const visibleSigByIndex = new Map<number, SignVisibleSigInput>();
  for (const item of items) {
    const index = files.length;
    files.push(item.file);
    if (item.placement !== undefined) visibleSigByIndex.set(index, item.placement);
  }
  return { files, visibleSigByIndex };
}

/**
 * Separa qué ya se analizó de qué falta, para que volver al paso 1, agregar un
 * documento y volver al paso 2 no repita el trabajo de los que no cambiaron.
 *
 * Identidad por REFERENCIA de objeto `File` (`===`), igual que el resto de
 * este flujo (ver `stillSelected` en `FirmarLote.svelte`): dos archivos con el
 * mismo nombre y tamaño pueden ser objetos `File` distintos — típicamente
 * porque la persona quitó uno del picker y volvió a seleccionarlo — y ESE caso
 * debe tratarse como nuevo, no como "ya lo tengo".
 *
 * Devuelve `kept` y `pending` por separado (no mezclados en el orden final de
 * `files`) para no imponerle a este módulo una noción de "documento en
 * proceso" que no tiene: el llamante ya sabe construir la lista combinada
 * mientras `pending` se resuelve (ver `onItem` en `goToReview`), así que
 * duplicar ese merge aquí solo movería la responsabilidad sin simplificar
 * nada.
 */
export function splitPreflightWork(
  files: readonly File[],
  previous: readonly PreflightItem[],
): { kept: PreflightItem[]; pending: File[] } {
  const previousByFile = new Map(previous.map((item) => [item.file, item]));

  const kept: PreflightItem[] = [];
  const pending: File[] = [];
  for (const file of files) {
    const existing = previousByFile.get(file);
    if (existing !== undefined) {
      kept.push(existing);
    } else {
      pending.push(file);
    }
  }

  return { kept, pending };
}

export async function preflightBatch(
  files: readonly File[],
  opts: PreflightOptions = {},
): Promise<PreflightReport> {
  const items: PreflightItem[] = [];

  // UN worker por lote, no uno por documento: evita pagar N veces el arranque
  // del chunk de `@firma-ec/signer` que `preflight-core.ts` importa.
  let session = openPreflightSession();

  try {
    for (const [index, file] of files.entries()) {
      if (opts.signal?.aborted) break;

      const item = await preflightOne(file, `${opts.runId ?? 'pf'}-${index}`, session);
      items.push(item);
      opts.onItem?.(item, index);

      // Un timeout dejó el worker anterior terminado (ver
      // PreflightSession.analyze): el siguiente documento necesita una sesión
      // fresca, no el cadáver del worker que acaba de matarse.
      if (session.isClosed && !opts.signal?.aborted) {
        session = openPreflightSession();
      }
    }
  } finally {
    // Cubre las tres salidas del bucle (éxito, `signal.aborted`, o el lote se
    // vació): la sesión activa nunca debe quedar como un worker huérfano vivo.
    // Idempotente si un timeout ya la cerró.
    session.terminate();
  }

  return {
    items,
    ready: items.filter((i) => i.status === 'ready').length,
    needsReview: items.filter((i) => i.status === 'needs_review').length,
    unreadable: items.filter((i) => i.status === 'unreadable').length,
  };
}
