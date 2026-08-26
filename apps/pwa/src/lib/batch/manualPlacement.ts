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
import type { PageGeometry } from '@firma-ec/signer';
import { type ExistingSigRect, VISIBLE_MIN, rectsOverlap } from '../../ui/firma/smartPlacement.ts';
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

/**
 * ¿Puede esta UI pintar y firmar en el MISMO espacio de coordenadas que usa el
 * motor para esta página?
 *
 * El motor emite puntos PDF **absolutos y sin rotar**; tanto `BoxPlacer` como
 * `SimplePlacer` pintan sobre el viewport de pdf.js, que ya viene **rotado** y
 * con origen en el **CropBox**. Los dos espacios coinciden solo cuando la
 * página no está rotada y su área visible arranca en el origen. En cualquier
 * otro caso el preview mentiría: caja dibujada en un sitio y `/Rect` estampado
 * en otro — el peor fallo posible aquí, porque se ve bien y sale mal.
 *
 * Vive aquí y no dentro de un `<script>` de Svelte precisamente para poder
 * probarse: es la guarda cuyo fallo produce una firma fuera de sitio en un
 * documento real, y hasta el QA dual del e2e no tenía una sola prueba.
 *
 * Nota: `FirmarLote.svelte` sujeta el mismo invariante con un predicado más
 * flojo (solo `rotate`). Ésta es la versión estricta; unificar las dos exige
 * tocar el colocador del lote y queda fuera de este alcance.
 */
export function isUiSpaceSafe(geo: PageGeometry | undefined): boolean {
  if (!geo) return false;
  return geo.rotate === 0 && geo.visX === 0 && geo.visY === 0;
}

/** Lo que decide si vuelve el default centrado de `BoxPlacer`. */
export interface CenteredDefaultInputs {
  /** Modo guiado (`SimplePlacer`), que trae su propio escaneo de firmas previas. */
  guided: boolean;
  /** ¿Hay ya una caja puesta (por la persona o por el motor)? */
  hasBox: boolean;
  /** Firmas previas que detectó el análisis del documento (`/ByteRange`). */
  priorSignatures: number;
  /** ¿Llegó ya el escaneo anti-solape de widgets de pdf.js? */
  scanSeen: boolean;
}

/**
 * ¿Debe volver el default centrado de `BoxPlacer` al terminar el motor?
 *
 * Vive aquí, fuera del `<script>` de Svelte, porque tiene DOS mitades y sólo
 * una estaba probada. La mitad permisiva («reactiva») la cubre el e2e de la
 * firma invisible; la mitad **supresora** («sigue esperando») no la cubría
 * nada: mutar el gate a `true` incondicional dejaba 440 tests en verde. Un
 * detector sólo cuenta como probado cuando se afirman sus dos direcciones.
 *
 * La única razón para suprimir el default es que el anti-solape esté **en
 * camino**: un documento con firmas previas cuyo escaneo de widgets aún no ha
 * llegado. Fuera de ese caso hay que reponerlo, porque `scanSignatureWidgets`
 * corre una sola vez por carga y nadie más lo hará — y sin default, el paso 2
 * se queda sin ninguna caja.
 */
export function shouldRestoreCenteredDefault(o: CenteredDefaultInputs): boolean {
  if (o.guided) return true; // el guiado no cablea `onSignaturesScanned`
  if (o.hasBox) return true; // no-op: reponerlo no mueve una caja ya puesta
  if (o.priorSignatures === 0) return true; // no hay firmas: nada que esquivar
  return o.scanSeen; // con firmas: sólo si el anti-solape ya tuvo su turno
}

/** Lo que decide si el lote pide una segunda confirmación antes de firmar. */
export interface OverlapConfirmationInputs {
  /**
   * El barrido de firmas previas no pudo mirar todo el documento
   * (`SignatureScan.incomplete`): puede haber firmas que NO están en la lista.
   */
  scanIncomplete: boolean;
  /** La caja solapa alguna de las firmas que sí se llegaron a ver. */
  overlapsKnown: boolean;
}

/**
 * ¿Hay que pedir confirmación extra antes de estampar en el lote?
 *
 * Existe como función y no como dos asignaciones sueltas por un motivo medido:
 * la línea que forzaba el aviso ante un escaneo ciego podía borrarse dejando
 * **411 unitarios y 50 e2e en verde** — o sea, la protección que da sentido al
 * arreglo del escaneo no tenía ninguna red. Aquí sí la tiene, y en las dos
 * direcciones.
 *
 * `scanIncomplete` cuenta tanto como un solape real: si no pudimos mirar parte
 * del documento, «no solapa» es una afirmación que no podemos hacer. En el
 * lote nadie revisa página a página y el error es irreversible (el PDF sale
 * con PKCS#7 + TSA + OCSP ya gastados), así que ante la duda se pregunta.
 */
export function needsOverlapConfirmation(o: OverlapConfirmationInputs): boolean {
  return o.scanIncomplete || o.overlapsKnown;
}
