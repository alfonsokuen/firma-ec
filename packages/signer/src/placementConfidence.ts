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

import type { AnchorKind } from './anchorMatch.js';
import type { AnchorSignal } from './anchorPlacement.js';
import { type AutoPlacement, GAP, bottomGap, textBelow } from './autoPlacement.js';
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
  | 'texto_por_debajo'
  /**
   * (FASE 3, re-acotada tras la medición del corpus real) Dos o más
   * etiquetas "Firma" genéricas en la página, sin ningún nombre/cédula del
   * firmante en todo el documento que diga cuál es la nuestra — un contrato
   * bipartito sin forma de saber a quién pertenece cada bloque.
   *
   * Solo se evalúa cuando el ancla es PERSONALIZADA
   * (`AnchorClassificationContext.personalized === true`): con etiqueta
   * genérica sola, esta señal NO se emite. Ver el comentario en
   * `classifyPlacement` para los números medidos.
   */
  | 'ancla_ambigua'
  /**
   * (FASE 3) La página del ancla se leyó con cobertura de decode < 0.9: no
   * sabemos qué anclas NO vimos ahí, así que la que sí se encontró tampoco
   * merece confianza plena.
   */
  | 'ancla_ilegible'
  /**
   * (FASE 3) El nombre del firmante apareció en mitad de una cláusula —con
   * ≥3 líneas de texto corrido debajo del bloque, no un bloque de firma
   * aislado— y no junto a la firma.
   */
  | 'ancla_en_parrafo'
  /**
   * (FASE 3, re-acotada tras la medición del corpus real) Había un ancla,
   * pero el sitio que señalaba estaba ocupado (firma previa o texto): la
   * colocación cayó al pipeline normal en vez de honrar el ancla. Nunca sale
   * por debajo de `media`.
   *
   * Solo se evalúa cuando el ancla es PERSONALIZADA (ver `ancla_ambigua`
   * arriba): con etiqueta genérica sola, esta señal NO se emite.
   */
  | 'ancla_sin_sitio';

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
/**
 * Lo que el clasificador necesita saber del ancla de texto (FASE 3), aparte
 * de lo que ya trae `placement` (`source`/`anchorKind`).
 *
 * `undefined` cuando no se intentó ningún ancla (sin `signerName`/`cedula`,
 * o el documento no tenía ninguna) — un significado distinto de "se intentó
 * y no se sabe": aquí sí es correcto que la ausencia decida por sí sola, a
 * diferencia de `imageOnlyPages` et al., porque no hay una fuente que
 * "olvide" pasar este campo por accidente: quien no usa el ancla no tiene
 * nada que reportar.
 */
export interface AnchorClassificationContext {
  readonly kind: AnchorKind;
  readonly personalized: boolean;
  readonly signals: readonly AnchorSignal[];
  /** `true` si la colocación final aterrizó en el ancla (`placement.source === 'text-anchor'`). */
  readonly honored: boolean;
  /** Cobertura de decode de la página del ancla, o `null` si no se pudo medir. */
  readonly pageCoverage: number | null;
}

export interface ClassifyPlacementOpts {
  placement: AutoPlacement;
  geometry: readonly PageGeometry[];
  textBands: readonly TextBand[];
  unanalyzedPages: readonly number[];
  imageOnlyPages: readonly number[];
  ocrOnlyPages: readonly number[];
  anchor?: AnchorClassificationContext;
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
 * Cuántas líneas tienen que quedar por debajo de la estampa para que eso sea
 * "el documento sigue debajo" y no "la estampa está encima del pie de página".
 *
 * La primera versión disparaba con UNA franja cualquiera, y en el corpus real
 * eso resultó ser casi siempre el número de página. Medido sobre 53 documentos
 * del usuario, en los seis casos que se inspeccionaron uno a uno lo que había
 * debajo era **una sola línea de 8 a 25 pt pegada al borde inferior** — pie de
 * página, exactamente donde una firma DEBE ir por encima. La señal, pensada
 * para cazar "la firma quedó a media hoja con el contrato debajo", disparaba
 * con la numeración, que es ubicua.
 *
 * Tres es lo que separa un pie de un párrafo: un pie son una o dos líneas
 * (número de página y a lo sumo una leyenda); tres líneas seguidas ya es texto
 * corrido. Se cuenta en LÍNEAS y no en puntos porque un pie con tipografía
 * grande sigue siendo un pie.
 */
const MIN_LINES_BELOW_FOR_BLOCK = 3;

/**
 * Hasta qué altura sobre el pie de la página se considera que la estampa cayó
 * DONDE CAEN LAS FIRMAS.
 *
 * Esto corrige el error de fondo de la primera versión: `hueco_unico` y
 * `hueco_justo` no miden si el resultado es dudoso, miden **cuánta libertad
 * tuvo el algoritmo**. Y las dos cosas se confunden justo donde no deben. Sobre
 * 53 documentos reales, las estampas marcadas por "único hueco" estaban todas
 * en `y=18` —el pie de la última página, la posición más convencional que
 * existe para una firma— y las marcadas por "hueco justo" entre 27 y 84,
 * encajadas entre el último párrafo y el número de página. Poca libertad y
 * posición canónica no es sospecha: es exactamente lo que se esperaba.
 *
 * Así que la estrechez solo cuenta cuando la posición NO es convencional. Una
 * firma en mitad del documento y con poco aire alrededor sí es dudosa; al pie
 * de la última hoja, no.
 *
 * 120 pt ≈ 4,2 cm: la banda donde viven el bloque de firma y el pie. El caso
 * real más alto que sigue siendo convencional midió 84; el más bajo que NO lo
 * era, 220.
 */
const FOOTER_ZONE_PT = 120;

/**
 * Cobertura de decode por debajo de la cual la página del ancla se considera
 * parcialmente ilegible (ver `ancla_ilegible`). No es que la ancla encontrada
 * esté mal: es que no sabemos qué anclas NO se vieron ahí — un 10% del texto
 * de la página ilegible es más que suficiente para que "Firma:" o el nombre
 * completo del firmante cayeran justo en ese 10%.
 */
const ANCHOR_ILLEGIBLE_COVERAGE = 0.9;

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

  // ¿Acabó donde acaban las firmas? Pie de la ÚLTIMA página. Si sí, que hubiera
  // un único hueco o poco aire alrededor deja de ser señal: es lo esperado.
  const lastPage = opts.geometry[opts.geometry.length - 1]?.page;
  const conventional = page === lastPage && bottomGap(placement, geo) <= FOOTER_ZONE_PT;

  // `hueco_justo` no mide nada cuando la fuente es `reserved-gap`: la estampa
  // se planta en `top + GAP*0.5` (ver {@link reservedGapV}), así que su holgura
  // vale SIEMPRE exactamente `GAP/2`. Medido sobre el corpus real: 7 pt en el
  // 100% de los casos, tanto en los aciertos como en los errores. Una señal que
  // no varía no informa, y aquí solo servía para marcar como dudosa a una clase
  // entera de colocaciones por un rasgo que su propio constructor le impone.
  //
  // La exención llega hasta ahí y ni un paso más. Las otras dos señales siguen
  // vivas a propósito, porque `reservedGapV` NO comprueba que el hueco sea un
  // área de firma —solo que no haya bandas de texto—, y un claro sin bandas no
  // es un claro sin contenido: ahí viven los sellos, las rúbricas escaneadas y
  // las figuras, que el lector ignora por diseño. Con las tres apagadas, esta
  // clase salía `alta` constante —7.083 de 7.083 colocaciones medidas, cero
  // motivos— y un clasificador que no puede opinar tampoco puede equivocarse:
  // su acierto y su fallo se vuelven indistinguibles.
  const tautologicalClearance = placement.source === 'reserved-gap';

  // FASE 3 — un ancla PERSONALIZADA honrada (`text-anchor` con nombre/cédula)
  // sustituye `hueco_unico`/`hueco_justo`/`texto_por_debajo` por sus
  // contrapartes de ancla: `reservedGapV` NO comprueba que el hueco sea un
  // área de firma —solo que no haya bandas de texto—, así que un ancla
  // personalizada tiene la MISMA tautología estructural que `reserved-gap`
  // (ver `tautologicalClearance` arriba) y las mismas señales que no
  // aportan nada se volverían constantes por el mismo motivo. Para un ancla
  // GENÉRICA (`firma-label`) se mantienen las dos familias, tal cual.
  const anchor = opts.anchor;
  const personalizedHonored = anchor?.honored === true && anchor.personalized;

  const tight: ConfidenceReason[] = [];
  const survey = placement.survey;
  if (!personalizedHonored) {
    if (survey && !conventional) {
      if (survey.slots === 1) tight.push('hueco_unico');
      if (
        !tautologicalClearance &&
        survey.clearance !== null &&
        survey.clearance <= TIGHT_CLEARANCE_PT
      ) {
        tight.push('hueco_justo');
      }
    }
    if (textBelow(placement, geo, opts.textBands).lines >= MIN_LINES_BELOW_FOR_BLOCK) {
      tight.push('texto_por_debajo');
    }
  } else if (textBelow(placement, geo, opts.textBands).lines >= MIN_LINES_BELOW_FOR_BLOCK) {
    // Medido desde el FONDO DEL BLOQUE ANCLA, no de la estampa — pero cuando
    // el ancla se HONRÓ la estampa se planteó justo ahí (`preferredV` es lo
    // primero que prueba `enumerateSlots`), así que son el mismo punto.
    tight.push('ancla_en_parrafo');
  }

  if (anchor) {
    if (anchor.pageCoverage !== null && anchor.pageCoverage < ANCHOR_ILLEGIBLE_COVERAGE) {
      tight.push('ancla_ilegible');
    }
    // Estas dos SOLO opinan cuando el ancla es personalizada, y el motivo es
    // una medición, no una intuición: sobre 1.457 PDFs reales, activarlas
    // también para la etiqueta genérica hundió la confianza `alta` del 82,9%
    // al 51,7% sin cerrar UN SOLO documento de los 143 que no tenían
    // colocación. `ancla_sin_sitio` disparaba en 501 de 1.314 documentos y
    // `ancla_ambigua` en 283.
    //
    // La causa es que "firma" es una palabra corriente en sitios que no son
    // una zona de firma —disclaimers, "documento sin necesidad de firma
    // manuscrita", menciones dentro de una cláusula—, así que una etiqueta
    // genérica sin honrar no es evidencia de que la colocación sea mala: es
    // evidencia de que la palabra es común. El nombre o la cédula del
    // firmante, en cambio, sí son un indicio fuerte de dónde va SU firma, y
    // que no se pueda honrar sí merece bajar la confianza.
    //
    // La etiqueta genérica sigue COLOCANDO (aporta `preferredV`/`preferredU`);
    // lo único que se le retira es la opinión sobre la confianza. Y no queda
    // muda por ello: sigue sujeta a `hueco_unico`, `hueco_justo`,
    // `texto_por_debajo` y a toda la familia de ceguera, como cualquier otra
    // fuente — sin eso sería una clase incapaz de salir de `alta`, que es
    // exactamente el fallo que este clasificador ya cometió una vez.
    if (anchor.personalized) {
      if (anchor.signals.includes('ancla_ambigua')) tight.push('ancla_ambigua');
      if (!anchor.honored) tight.push('ancla_sin_sitio');
    }
  }

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
