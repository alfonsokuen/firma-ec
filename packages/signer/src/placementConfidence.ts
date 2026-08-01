/**
 * placementConfidence.ts — de qué colocación automática fiarse.
 *
 * El lote firma hasta cincuenta documentos con una sola sesión de clave. La
 * promesa del producto es que la persona vea dónde va a caer la estampa ANTES
 * de dar el PIN, pero enseñar cincuenta vistas previas no es revisar: es
 * cansancio, y el cansancio aprueba. La vista previa tiene que ser la
 * EXCEPCIÓN, y este módulo es quien decide cuándo.
 *
 * No mira el documento: mira lo que el análisis ya sabía y tiraba —cuántos
 * huecos había, cuánto aire quedaba, si la página se pudo leer siquiera— y lo
 * traduce a una decisión. Módulo puro, sin red, sin disco, sin reloj.
 *
 * Los motivos salen en código estable, no en prosa: quien pinta la pantalla los
 * traduce. Un motivo NUNCA lleva el nombre del documento ni nada del contenido.
 */

import { type AutoPlacement, GAP, hasTextBelow } from './autoPlacement.js';
import type { PageGeometry } from './pageGeometry.js';
import type { TextBand } from './textBands.js';

export type ConfidenceLevel = 'alta' | 'media' | 'baja';

/**
 * Por qué la colocación no es de fiar. Se agrupan en dos familias que se
 * evalúan distinto:
 *
 * - **Ceguera** — no se pudo mirar la página. Uno solo basta para bajar del
 *   todo: no es que el sitio sea estrecho, es que no sabemos qué hay ahí.
 * - **Estrechez** — se miró y el sitio es justo. Una señal sola es un aviso;
 *   dos o más, un documento que hay que enseñar.
 */
export type ConfidenceReason =
  /** El documento se apartó: no hay colocación automática de la que fiarse. */
  | 'sin_colocacion_automatica'
  /** La página elegida es un escaneo: la estampa puede caer sobre lo escaneado. */
  | 'pagina_escaneada'
  /** El único texto de la página va invisible — capa OCR de un escaneo. */
  | 'capa_ocr'
  /** La página elegida no se pudo recorrer entera, por un motivo que no se supo. */
  | 'pagina_no_analizada'
  /** Solo cabía en un sitio: no había alternativa que comparar. */
  | 'hueco_unico'
  /** El sitio elegido roza la separación mínima que el buscador acepta. */
  | 'hueco_justo'
  /** Queda texto por debajo de la estampa: no es donde va una firma. */
  | 'texto_por_debajo';

export interface PlacementConfidence {
  level: ConfidenceLevel;
  /** En el orden en que se evalúan. Vacío si y solo si el nivel es `alta`. */
  reasons: ConfidenceReason[];
}

/**
 * Todo lo que el clasificador necesita. Ni un campo es opcional, y es a
 * propósito.
 *
 * Cuando lo eran, omitir `imageOnlyPages` no significaba "no lo sé": se leía
 * como "no es un escaneo", y el MISMO documento salía `baja pagina_escaneada`
 * con la lista o `alta` sin ella. Es la familia de fallo que este proyecto ya
 * sufrió con `textBands: []`, agravada: lo que se decide aquí no es dónde va la
 * estampa, es a quién NO se le enseña antes de pedirle el PIN.
 *
 * Todas salen juntas de `analyzePdfForPlacement`, así que exigirlas no le cuesta
 * nada a quien llama — y convierte el olvido en un error de compilación en vez
 * de en un veredicto de confianza máxima.
 */
export interface ClassifyPlacementOpts {
  placement: AutoPlacement;
  geometry: readonly PageGeometry[];
  textBands: readonly TextBand[];
  unanalyzedPages: readonly number[];
  imageOnlyPages: readonly number[];
  ocrOnlyPages: readonly number[];
}

/**
 * Holgura por debajo de la cual el sitio se considera justo.
 *
 * No es un número elegido: `GAP/2` es exactamente la separación mínima que
 * {@link enumerateSlots} exige para dar un hueco por libre. Un sitio que la
 * roza es el sitio más apretado que el algoritmo puede devolver — cabe por
 * definición y por nada más. El epsilon absorbe el redondeo de coma flotante
 * al transformar entre espacios de coordenadas.
 *
 * Se elige el mínimo estructural, y no un umbral intermedio, porque el corpus
 * real no ofrece ni un solo documento entre 7 pt y 221 pt de holgura: cualquier
 * valor de ese hueco estaría igual de justificado por los datos, es decir,
 * ninguno lo estaría. El mínimo, al menos, significa algo por sí solo.
 */
const TIGHT_CLEARANCE_PT = GAP * 0.5 + 0.5;

/**
 * Cuántas señales de estrechez hacen falta para bajar a `baja`. Con una sola se
 * queda en `media`: un hueco único en una hoja despejada es raro, pero no
 * sospechoso.
 */
const TIGHT_REASONS_FOR_LOW = 2;

/**
 * Clasifica la confianza en una colocación automática.
 *
 * Un documento apartado (`needs_review`) sale `baja`, no sin clasificar: la
 * confianza en su colocación automática es cero porque no hay ninguna, y el
 * camino que le corresponde —enseñárselo a una persona— es el mismo. Así
 * la regla de la pantalla es una sola: **`baja` ⇒ vista previa**, venga de
 * donde venga.
 */
export function classifyPlacement(opts: ClassifyPlacementOpts): PlacementConfidence {
  const { placement } = opts;
  if (placement.status !== 'ok') {
    return { level: 'baja', reasons: ['sin_colocacion_automatica'] };
  }

  const page = placement.page;
  const geo = opts.geometry.find((g) => g.page === page);
  // Sin la geometría de la página elegida no se puede mirar NADA de ella: ni si
  // hay texto debajo, ni en qué eje. Eso es ceguera, no ausencia de problemas.
  if (!geo) return { level: 'baja', reasons: ['pagina_no_analizada'] };

  const blind: ConfidenceReason[] = [];
  // `else if` a propósito: los tres motivos llevan al MISMO nivel y lo que
  // cambia es la explicación que recibe la persona. Un escaneo con capa OCR es
  // un escaneo; decir las dos cosas no informa mejor, alarga.
  if (opts.imageOnlyPages.includes(page)) blind.push('pagina_escaneada');
  else if (opts.ocrOnlyPages.includes(page)) blind.push('capa_ocr');
  else if (opts.unanalyzedPages.includes(page)) blind.push('pagina_no_analizada');

  const tight: ConfidenceReason[] = [];
  const survey = placement.survey;
  if (survey) {
    if (survey.slots === 1) tight.push('hueco_unico');
    if (survey.clearance !== null && survey.clearance <= TIGHT_CLEARANCE_PT) {
      tight.push('hueco_justo');
    }
  }
  if (hasTextBelow(placement, geo, opts.textBands)) tight.push('texto_por_debajo');

  const reasons = [...blind, ...tight];
  // La ceguera manda por sí sola: una página escaneada con la estampa al pie no
  // enseña ninguna señal de estrechez —no hay bandas que medir— y sin esta
  // regla saldría con la misma confianza que una hoja realmente en blanco.
  if (blind.length > 0 || tight.length >= TIGHT_REASONS_FOR_LOW) {
    return { level: 'baja', reasons };
  }
  if (tight.length > 0) return { level: 'media', reasons };
  return { level: 'alta', reasons: [] };
}
