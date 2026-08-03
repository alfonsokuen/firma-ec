/**
 * preflight-core.ts — el NÚCLEO puro de la decisión de colocación.
 *
 * Extraído de `preflight.ts` (F0 fase 1) como movimiento puro: la lógica de
 * `analyzeForPreflight` es EXACTAMENTE la que vivía en `preflightOne`, sin
 * reescribir ninguna condición ni cambiar ningún string de `reason`. Lo único
 * que cambia es la entrada: en vez de un `File`, recibe los bytes ya leídos.
 *
 * Deliberadamente agnóstico de `File`/DOM — no importa nada del navegador —
 * para que un Web Worker (F0 fase 2) pueda importar este módulo sin arrastrar
 * el tipo `File`, que no existe en ese contexto sin `lib.dom`.
 *
 * Privacidad: no registra nada. El contenido del documento no sale de aquí —
 * ni a consola, ni a un `Error`, ni a la red.
 */

import {
  type AutoPlacement,
  analyzePdfForPlacement,
  computeAutoPlacement,
  detectSignatures,
} from '@firma-ec/signer';
import type { SignVisibleSigInput } from '../workers/sign-bus';
import type { PlacementSource, PreflightItem, PreflightStatus } from './preflight';

/**
 * Resultado del análisis puro de UN documento: los mismos campos que
 * {@link PreflightItem} hoy expone, menos `id` y `file` — esos dos son
 * responsabilidad de quien orquesta el lote (`preflight.ts`), no de este
 * núcleo agnóstico de dónde vinieron los bytes.
 */
export type PreflightOutcome = Omit<PreflightItem, 'id' | 'file'>;

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

/**
 * Resuelve dónde caería la estampa en UN documento, a partir de sus bytes ya
 * leídos. No lanza: todo fallo es un estado.
 *
 * Reproduce el cruce del worker contra `detectSignatures`
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
 */
export async function analyzeForPreflight(pdfBytes: Uint8Array): Promise<PreflightOutcome> {
  const analysis = await analyzePdfForPlacement(pdfBytes);

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
      status: 'ready' as PreflightStatus,
      page: placement.page,
      pageCount,
      source: placement.source as PlacementSource,
    };

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
    status: analysis.failure ? 'unreadable' : 'needs_review',
    page: placement.page,
    pageCount,
    reason: analysis.failure ?? placement.reason,
  };
}
