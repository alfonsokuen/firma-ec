import { type ExistingSigRect, VISIBLE_MIN, rectsOverlap } from '../../ui/firma/smartPlacement.ts';
/**
 * manualPlacement.ts — la parte pura del colocador manual de UN documento del
 * lote (F1 fase B). Extraída de `FirmarLote.svelte` a propósito: es la única
 * lógica de esa sub-vista que no depende de Svelte ni del DOM, así que puede
 * probarse con `vitest` puro (entorno `node`, sin harness de componentes) en
 * vez de quedar enterrada dentro de un `<script>` inalcanzable para un test.
 *
 * 🔴 TRAMPA que este módulo existe para blindar — convención de página:
 * `BoxPosition.page` (BoxPlacer.svelte) es 1-based, tal como la persona lo ve
 * ("página 3 de N"). El motor (`SignVisibleSigInput.page`,
 * `PreflightItem.placement.page`) es 0-based. El comentario de BoxPlacer dice
 * "matches the worker SignVisibleSigInput convention" — MIENTE: la prueba es
 * que `Firmar.svelte` hace `page: boxPos.page - 1` explícitamente al construir
 * `visibleSig` en `onSignNow` (Firmar.svelte:518). `toManualPlacement` hace la
 * MISMA resta, en un único punto, para que ningún otro sitio del colocador de
 * lote tenga que acordarse de repetirla.
 */
import type { SignVisibleSigInput } from '../workers/sign-bus';

/** Lo que emite BoxPlacer: `page` 1-based, rect en PDF pt. */
export interface ManualBoxPosition {
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Convierte la posición 1-based de BoxPlacer al `SignVisibleSigInput` 0-based
 * que espera el motor de firma. Único punto de conversión — ver la trampa
 * documentada arriba.
 */
export function toManualPlacement(pos: ManualBoxPosition): SignVisibleSigInput {
  return {
    page: pos.page - 1,
    x: pos.x,
    y: pos.y,
    width: pos.w,
    height: pos.h,
  };
}

/**
 * Inversa de {@link toManualPlacement}: convierte el rect 0-based del motor al
 * 1-based que consume `BoxPlacer`. Vive aquí, junto a su gemela, por la misma
 * razón que ella — la conversión de convenio ocurre en UN punto y no repartida
 * por las vistas.
 *
 * `rotate` NO viaja de vuelta: `BoxPosition` describe el rect en el espacio de
 * la página y no tiene dónde guardarlo. Quien reciba esto debe conservar el
 * `rotate` del motor aparte y volver a ponerlo al firmar; si no, la estampa se
 * dibuja derecha en una página girada. Ver {@link engineRotateFor}.
 */
export function fromEnginePlacement(p: SignVisibleSigInput): ManualBoxPosition {
  return {
    page: p.page + 1,
    x: p.x,
    y: p.y,
    w: p.width,
    h: p.height,
  };
}

/** Lo que el motor decidió: el rect COMPLETO (1-based) más el `/Rotate`. */
export interface EnginePlacementMeta extends ManualBoxPosition {
  /** `/Rotate` de esa página. Ausente = sin rotación. */
  readonly rotate?: 0 | 90 | 180 | 270;
}

/**
 * Tolerancia de coincidencia entre la caja actual y la que midió el motor.
 * Mismo criterio que `PROPAGATION_MATCH_EPSILON` (preflight-core.ts): ruido de
 * coma flotante, no un umbral de "casi igual" — un arrastre o resize real se
 * mide en puntos enteros.
 */
const ENGINE_RECT_EPSILON = 0.5;

/**
 * `/Rotate` que debe viajar al firmante para la caja `box`.
 *
 * La guarda compara el RECT completo, no solo la página: el `rotate` describe
 * la caja que el motor midió en el espacio físico de esa página. En cuanto la
 * persona la mueve o redimensiona —aunque sea dentro de la misma hoja— el rect
 * ya viene del viewport de pdf.js (que en páginas giradas está EN OTRO
 * espacio, ya rotado), y adjuntarle el `rotate` del motor lo re-rotaría.
 * Una rotación equivocada dibuja la estampa de lado: peor que no mandar
 * ninguna (sin `rotate` el firmante asume 0, el caso del 97% de los
 * documentos). Ante cualquier edición, no se manda.
 *
 * Nota (2026-08-25): con la guarda de espacio de `Firmar.svelte`
 * (`uiSpaceSafe` exige `rotate === 0`), en ese flujo `meta.rotate` hoy solo
 * puede valer `0`/`undefined` — esta guarda queda LATENTE hasta que la UI
 * aprenda a pintar páginas rotadas. No invertir más aquí creyéndola caliente.
 */
export function engineRotateFor(
  meta: EnginePlacementMeta | null,
  box: ManualBoxPosition,
): 0 | 90 | 180 | 270 | undefined {
  if (!meta || meta.rotate === undefined) return undefined;
  const untouched =
    meta.page === box.page &&
    Math.abs(meta.x - box.x) <= ENGINE_RECT_EPSILON &&
    Math.abs(meta.y - box.y) <= ENGINE_RECT_EPSILON &&
    Math.abs(meta.w - box.w) <= ENGINE_RECT_EPSILON &&
    Math.abs(meta.h - box.h) <= ENGINE_RECT_EPSILON;
  return untouched ? meta.rotate : undefined;
}

/**
 * ¿El rect que la persona confirmó se solapa con una firma previa VISIBLE de
 * ESE MISMO documento? `widgets` viene de `PdfPreview.onSignaturesScanned`
 * (rects reales de los widgets de firma, 0-based) — no de `detectSignatures`
 * (que solo da `signerCN`/`signingTime`/`byteRange`, sin geometría: no sirve
 * para esta comparación). Sin holgura extra (`pad: 0`): el aviso es una ayuda,
 * no un bloqueo, así que se dispara solo ante un solape real, no uno "casi".
 */
export function overlapsExistingSignature(
  pos: ManualBoxPosition,
  widgets: readonly ExistingSigRect[],
): boolean {
  const enginePage = pos.page - 1;
  return widgets.some(
    (w) =>
      w.page === enginePage && w.w > VISIBLE_MIN && w.h > VISIBLE_MIN && rectsOverlap(pos, w, 0),
  );
}
