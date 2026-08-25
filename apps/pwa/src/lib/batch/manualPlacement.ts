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

/** Lo que el motor decidió, conservado por la vista junto al rect. */
export interface EnginePlacementMeta {
  /** Página (1-based) que el motor midió. */
  readonly page: number;
  /** `/Rotate` de ESA página. Ausente = sin rotación. */
  readonly rotate?: 0 | 90 | 180 | 270;
}

/**
 * `/Rotate` que debe viajar al firmante para una caja que ahora está en
 * `boxPage` (1-based).
 *
 * La guarda: el `rotate` describe la página que el motor midió. Si la persona
 * arrastró la caja a otra hoja, ese número ya no habla de la hoja donde va a
 * firmar — y una rotación equivocada dibuja la estampa de lado, que es peor
 * que no mandar ninguna (sin `rotate` el firmante asume 0, que es el caso del
 * 97% de los documentos). Ante la duda, no se manda.
 */
export function engineRotateFor(
  meta: EnginePlacementMeta | null,
  boxPage: number,
): 0 | 90 | 180 | 270 | undefined {
  if (!meta || meta.rotate === undefined) return undefined;
  return meta.page === boxPage ? meta.rotate : undefined;
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
