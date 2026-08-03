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
  type PageGeometry,
  analyzePdfForPlacement,
  computeAutoPlacement,
  detectSignatures,
  toCanonicalRect,
} from '@firma-ec/signer';
import type { SignVisibleSigInput } from '../workers/sign-bus';
import type { PlacementSource, PreflightItem, PreflightStatus } from './preflight';
import type { PropagationHint } from './propagation';

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
 * Misma holgura que `VISIBLE_AREA_EPSILON` en `autoPlacement.ts` (0.5pt): no
 * se importa —es una constante privada de ese módulo— pero el criterio de
 * "cayó en el mismo sitio" debe usar la misma tolerancia a ruido de coma
 * flotante que el motor, no una inventada aquí.
 */
const PROPAGATION_MATCH_EPSILON = 0.5;

/**
 * Compara dónde cayó la estampa contra dónde pedía el hint de propagación, en
 * espacio canónico. `undefined` cuando no hay hint que evaluar, cuando la
 * fuente elegida fue `empty-field` (un campo de firma declarado por el
 * documento gana SIEMPRE — fuente 1 de `computeAutoPlacement`, antes de que
 * el ancla del hint llegue a considerarse, así que el hint nunca se evaluó de
 * verdad y reportar `moved` ahí sería decir que el hint influyó cuando no fue
 * así), o cuando no hay geometría para la página resuelta (no se puede
 * comprobar nada: ausencia, no un resultado inventado).
 *
 * `'exact'` exige que las 4 dimensiones coincidan dentro del epsilon — x, y,
 * Y TAMBIÉN w/h contra `hint.boxW`/`hint.boxH`. El anti-solape puede encoger
 * la caja (`Math.min(boxW, orientedW*0.6)`/`Math.min(boxH, orientedH*0.2)` en
 * `autoPlacement.ts`) y aun así caer en el x/y exacto pedido: eso NO es
 * `'exact'`, porque el tamaño confirmado por la persona (`propagation.ts`,
 * "si encogió la caja para un hueco estrecho, ese es el tamaño que hay que
 * propagar") tampoco se respetó. `'moved'` ya comunica correctamente "no es
 * lo que pediste", sea por posición o por tamaño — no hace falta un tercer
 * estado para distinguir la causa.
 */
function classifyPropagation(
  hint: PropagationHint,
  placement: Extract<AutoPlacement, { status: 'ok' }>,
  geometry: readonly PageGeometry[],
): 'exact' | 'moved' | undefined {
  if (placement.source === 'empty-field') return undefined;
  if (placement.page !== hint.page) return 'moved';

  const geo = geometry.find((g) => g.page === placement.page);
  if (!geo) return undefined;

  const canonical = toCanonicalRect(geo, {
    x: placement.x,
    y: placement.y,
    w: placement.w,
    h: placement.h,
  });
  const matchesV = Math.abs(canonical.y - hint.preferredV) <= PROPAGATION_MATCH_EPSILON;
  const matchesU = Math.abs(canonical.x - hint.preferredU) <= PROPAGATION_MATCH_EPSILON;
  const matchesW = Math.abs(canonical.w - hint.boxW) <= PROPAGATION_MATCH_EPSILON;
  const matchesH = Math.abs(canonical.h - hint.boxH) <= PROPAGATION_MATCH_EPSILON;
  return matchesV && matchesU && matchesW && matchesH ? 'exact' : 'moved';
}

/**
 * El hint solo puede venir de una decisión de propagación de verdad
 * (`buildPropagationHint`, que ya valida esto mismo) o de haber cruzado el
 * protocolo del worker (`preflight-bus.ts`/`preflight.worker.ts`), donde no
 * hay ninguna garantía de que los 4 números sigan siendo los que se
 * fabricaron. Un `preferredV: NaN`/`Infinity` o un `boxW`/`boxH` ≤ 0 no debe
 * llegar a `computeAutoPlacement`: ese motor (F2a) ya sanitiza `preferredV`/
 * `preferredU` con `sanitizeAnchor`, pero `boxW`/`boxH` los usa tal cual, y un
 * hint corrupto que se cuela ahí degrada la colocación con un tamaño de caja
 * absurdo en vez de, simplemente, tratarse como si no hubiera hint.
 */
function isValidHint(hint: PropagationHint): boolean {
  return (
    Number.isFinite(hint.preferredV) &&
    Number.isFinite(hint.preferredU) &&
    Number.isFinite(hint.boxW) &&
    Number.isFinite(hint.boxH) &&
    hint.boxW > 0 &&
    hint.boxH > 0
  );
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
export async function analyzeForPreflight(
  pdfBytes: Uint8Array,
  opts?: { placementHint?: PropagationHint },
): Promise<PreflightOutcome> {
  const analysis = await analyzePdfForPlacement(pdfBytes);
  const rawHint = opts?.placementHint;
  // Un hint corrupto (NaN/Infinity, o boxW/boxH ≤ 0) se rechaza ANTES de
  // tocar el motor: se le pasan los defaults como si no existiera, y el
  // outcome lo dice con `propagated: 'hint_rejected'` (ver `isValidHint`).
  // Esto distingue "el hint que llegó era basura, lo rechacé yo" de "el hint
  // era válido, el motor decidió otra cosa" (`'moved'`), sin tocar el motor.
  const hintRejected = rawHint !== undefined && !isValidHint(rawHint);
  const hint = rawHint !== undefined && !hintRejected ? rawHint : undefined;

  const placement = computeAutoPlacement({
    geometry: analysis.geometry,
    existing: analysis.existing,
    emptySigFields: analysis.emptySigFields,
    textBands: analysis.textBands,
    unanalyzedPages: analysis.unanalyzedPages,
    ...(analysis.failure ? { failure: analysis.failure } : {}),
    ...(hint
      ? {
          boxW: hint.boxW,
          boxH: hint.boxH,
          anchor: {
            page: hint.page,
            preferredV: hint.preferredV,
            preferredU: hint.preferredU,
            kind: 'lote-propagacion' as const,
          },
        }
      : {}),
  });

  const pageCount = analysis.geometry.length;
  // Aditivo (F2b): se adjunta SOLO si hay páginas — ver P2 más abajo (contrato
  // de `PreflightItem.geometry`: ausente, nunca `[]`).
  const geometry = analysis.geometry;

  if (placement.status === 'ok') {
    const propagated = hintRejected
      ? ('hint_rejected' as const)
      : hint
        ? classifyPropagation(hint, placement, geometry)
        : undefined;
    const ready = {
      status: 'ready' as PreflightStatus,
      page: placement.page,
      pageCount,
      source: placement.source as PlacementSource,
      ...(geometry.length > 0 ? { geometry } : {}),
      ...(propagated ? { propagated } : {}),
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
        ...(geometry.length > 0 ? { geometry } : {}),
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
    ...(geometry.length > 0 ? { geometry } : {}),
  };
}
