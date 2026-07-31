/**
 * batchZip.ts — entrega del lote firmado: N PDFs firmados → UN archivo ZIP
 * construido en el navegador, entrada por entrada, mientras el lote se firma.
 *
 * ⚠️ NO TOCA EL SERVICE WORKER. Todo lo de aquí es una descarga normal
 * construida en el hilo del llamante; `sw.ts` y su estrategia de caché quedan
 * exactamente como están (una modificación ahí ya colgó la app en móvil en
 * producción). Streaming por SW sería la vía para levantar el tope — ver
 * {@link MAX_ZIP_TOTAL_BYTES} — y es precisamente lo que este módulo evita.
 *
 * ---------------------------------------------------------------------------
 * Decisión 1 — modo "store" (sin compresión), MEDIDO
 * ---------------------------------------------------------------------------
 * Deflate SÍ comprime estos PDFs: sobre el corpus real de fixtures del repo
 * (`packages/verifier/tests/fixtures`, `packages/signer/tests/fixtures`,
 * 1.072 KB en 7 documentos firmados) `deflateRaw` nivel 6 baja a 752 KB,
 * un **29,9 % de ganancia** (por documento: 37,2 % en `audit-075-firmado.pdf`,
 * 18,9 % en `carta-arrendamiento-firmado.pdf`, 28,1 % en
 * `eci-real-contrato2026.pdf`). Es decir: la premisa habitual de que "un PDF ya
 * viene comprimido" es FALSA en este corpus — los xref, los metadatos y los
 * streams sin `FlateDecode` todavía comprimen.
 *
 * Aun así el modo es `store`, por tres razones que pesan más que ese 30 %:
 *
 *  1. **El ZIP no viaja por ninguna red.** Se construye en la pestaña y se
 *     guarda en el disco del propio usuario, que lo descomprime acto seguido
 *     (invariante del producto: nada sale del dispositivo). Comprimir no ahorra
 *     ancho de banda, sólo bytes transitorios de disco.
 *  2. **La CPU sí se paga.** Medido con zlib NATIVO (C): 12,1 ms/MB a nivel 6.
 *     Un lote al tope de {@link MAX_ZIP_TOTAL_BYTES} son ~12 s de CPU en el
 *     mejor caso imaginable, y una implementación de deflate en JS dentro del
 *     navegador va 2-4× más lenta (25-50 s) sobre un teléfono de gama media,
 *     encima del coste de firmar. Se paga en la percepción de "colgado".
 *  3. **El tope hay que decidirlo ANTES de firmar**, cuando lo único conocido
 *     es `File.size`. Con `store` el tamaño de salida es una función exacta del
 *     de entrada, así que el rechazo previo es aritmética y no una apuesta. Con
 *     deflate el tamaño final es imprevisible, de modo que el tope seguiría
 *     calculándose sobre el tamaño SIN comprimir: la ganancia no se traduce en
 *     "más documentos por lote", que es lo único que el usuario notaría.
 *
 * Efecto colateral bueno: sin DEFLATE no hace falta ninguna dependencia (ver
 * decisión 3) y cada entrada lleva su CRC y sus tamaños reales en la cabecera
 * local, sin descriptores de datos — que es la forma de ZIP que más
 * extractores ajenos aceptan sin rechistar.
 *
 * ---------------------------------------------------------------------------
 * Decisión 2 — el tope, y por qué existe
 * ---------------------------------------------------------------------------
 * Sin File System Access API (sólo Chrome/Edge de escritorio) el ZIP se entrega
 * como descarga, así que el archivo COMPLETO tiene que existir antes de
 * empezar a descargarlo. Un lote máximo de la cola son 200 × 40 MB = 8 GB:
 * ni cabe en memoria ni cabe en el formato. Ver {@link MAX_ZIP_TOTAL_BYTES}.
 *
 * ---------------------------------------------------------------------------
 * Decisión 3 — sin dependencias
 * ---------------------------------------------------------------------------
 * Se evaluó `fflate` (MIT, sin dependencias transitivas, con API de streaming):
 * es la candidata correcta SI hay que comprimir. Al quedar el modo en `store`,
 * lo único que aporta una librería es el ensamblado de cabeceras — ~120 líneas
 * de estructuras de tamaño fijo (APPNOTE 6.3.x §4.3.7, §4.3.12, §4.3.16) que
 * aquí se escriben a mano y se verifican contra un extractor AJENO
 * (`batchZip.test.ts`). Añadir superficie de dependencia a una PWA de firma
 * para eso no se sostiene. Tampoco hace falta ZIP64: el tope deja el archivo
 * 4× por debajo del techo de 32 bits y el número de entradas 300× por debajo
 * de las 65.535 del directorio central.
 */

import {
  type BatchQueueItem,
  type BatchSignOptions,
  type RunBatchSignResult,
  runBatchSign,
} from '../workers/sign-queue';

// ---------------------------------------------------------------------------
// Constantes del formato ZIP (APPNOTE 6.3.x). Ninguna es negociable.
// ---------------------------------------------------------------------------

const SIG_LOCAL_HEADER = 0x04034b50;
const SIG_CENTRAL_HEADER = 0x02014b50;
const SIG_END_OF_CENTRAL_DIR = 0x06054b50;

const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const END_OF_CENTRAL_DIR_BYTES = 22;

/** `0` = almacenado sin comprimir. Ver la decisión 1 en la cabecera. */
const METHOD_STORE = 0;
/** Versión mínima capaz de leer una entrada `store`: 2.0. */
const VERSION_STORE = 20;
/** Bit 11 del campo de flags: los nombres van en UTF-8, no en CP437. */
const FLAG_UTF8_NAMES = 0x0800;

/** Máximo de entradas que el directorio central puede contar sin ZIP64 (16 bits). */
const ZIP_MAX_ENTRIES = 0xffff;
/** Techo de 32 bits de todo offset/tamaño del ZIP clásico: 4 GiB − 1. */
const ZIP_FORMAT_MAX_BYTES = 0xffffffff;

// ---------------------------------------------------------------------------
// Topes propios
// ---------------------------------------------------------------------------

/**
 * Tope de tamaño del ZIP entregable: **1 GiB**.
 *
 * De dónde sale el número (no está puesto a ojo):
 *  - **Techo del formato**: sin ZIP64 ningún offset ni tamaño pasa de
 *    {@link ZIP_FORMAT_MAX_BYTES} (4 GiB − 1). 1 GiB deja un factor 4 de
 *    margen, que es exactamente el colchón que absorbe que la estimación
 *    previa de {@link SIGNATURE_GROWTH_ALLOWANCE_BYTES} se quede corta.
 *  - **Techo del navegador**: al no haber File System Access, el archivo entero
 *    tiene que estar materializado antes de descargarlo. El pico real es el ZIP
 *    + el documento que se está firmando + las copias de trabajo del firmante.
 *    Una pestaña de Safari en iOS muere bastante antes de 2 GB, y el ZIP se
 *    apoya en almacenamiento de Blob, que Chrome empieza a volcar a disco
 *    pasados ~2 GB en memoria. 1 GiB es el valor que no se acerca al borde en
 *    el dispositivo más flaco que el producto soporta.
 *
 * ⚠️ **Para subir este tope hace falta dejar de construir el archivo en
 * memoria**: o File System Access API (`showSaveFilePicker`, escritura directa
 * a un fichero, sólo Chrome/Edge de escritorio) o streaming por Service Worker
 * (prohibido en este módulo: ver la cabecera). Y por encima de 4 GiB, además,
 * ZIP64. Cambiar sólo esta constante convierte el fallo de "lote rechazado con
 * un mensaje claro" en "pestaña muerta a mitad de firmar".
 */
export const MAX_ZIP_TOTAL_BYTES = 1024 * 1024 * 1024;

/**
 * Cuánto se reserva por documento para lo que la FIRMA añade, ya que el tope se
 * comprueba antes de firmar y entonces sólo se conoce `File.size`.
 *
 * Medido sobre el único par antes/después del repo:
 * `audit-075-2026.pdf` (323.077 B) → `audit-075-firmado.pdf` (389.909 B) =
 * **+66.832 B** con firma visible + DSS. Se reserva el doble (128 KiB) porque
 * un B-LTA con cadena completa, OCSP y CRL embebidos crece más que ese caso, y
 * quedarse corto aquí se paga tarde: el lote ya está a medio firmar.
 */
export const SIGNATURE_GROWTH_ALLOWANCE_BYTES = 128 * 1024;

/**
 * Tope de bytes UTF-8 por nombre de entrada: **200**.
 *
 * No es un límite del ZIP (el campo es de 16 bits) sino del destino: al extraer,
 * el nombre se concatena con la ruta de la carpeta y en Windows la ruta completa
 * choca contra MAX_PATH (260). 200 deja sitio para un
 * `C:\Users\<usuario>\Downloads\<carpeta del lote>\`.
 */
export const MAX_ENTRY_NAME_BYTES = 200;

/**
 * Peor caso de sobrecoste del ZIP por entrada: cabecera local + registro del
 * directorio central + el nombre repetido en ambos.
 */
const PER_ENTRY_OVERHEAD_BYTES =
  LOCAL_HEADER_BYTES + CENTRAL_HEADER_BYTES + 2 * MAX_ENTRY_NAME_BYTES;

/** Sufijo que distingue el PDF firmado del original. */
export const SIGNED_NAME_SUFFIX = '-firmado';

/** Extensión de salida: siempre PDF, es lo que el firmante produce. */
const PDF_EXTENSION = '.pdf';

/** Nombre de repuesto cuando el original no deja nada utilizable tras sanear. */
const FALLBACK_STEM = 'documento';

/** Dispositivos DOS que Windows sigue reservando en cualquier carpeta. */
const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

/**
 * Caracteres que Windows no admite y que si significan algo para quien lee el
 * nombre: se sustituyen por `_` para que el nombre siga siendo reconocible.
 * La barra y la contrabarra no estan porque los componentes de ruta se
 * descartan antes de llegar aqui.
 */
const FORBIDDEN_NAME_CHARS = /[<>:"|?*]/g;

/** Ultimo punto de codigo del bloque C0 de control. */
const LAST_C0_CONTROL_CODE = 0x1f;
/** DEL, que tampoco vale en un nombre de fichero. */
const DELETE_CONTROL_CODE = 0x7f;

/**
 * Quita los caracteres de control, sin sustituirlos: no representan nada que el
 * usuario pueda reconocer, asi que un guion bajo por cada uno solo anade ruido a
 * un nombre que ya venia roto. Se recorren puntos de codigo en vez de usar un
 * rango en la expresion regular para no dejar escapes de control en el fuente.
 */
function stripControlChars(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= LAST_C0_CONTROL_CODE || code === DELETE_CONTROL_CODE) continue;
    out += char;
  }
  return out;
}

export const ZIP_MIME_TYPE = 'application/zip';

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

export type BatchZipCapacityCode = 'zip_total_too_large' | 'zip_too_many_entries';

/**
 * El lote no cabe en un ZIP entregable.
 *
 * El mensaje nombra la causa y qué hacer, y **no lleva nombres de documentos**:
 * el nombre de un fichero es dato del usuario y un `Error` acaba en cualquier
 * manejador global. Sólo cuentas y megabytes.
 */
export class BatchZipCapacityError extends Error {
  constructor(
    public readonly code: BatchZipCapacityCode,
    message: string,
  ) {
    super(message);
    this.name = 'BatchZipCapacityError';
  }
}

// ---------------------------------------------------------------------------
// CRC-32 (ITU-T V.42, el que exige el ZIP)
// ---------------------------------------------------------------------------

const CRC32_POLYNOMIAL_REVERSED = 0xedb88320;
let crcTable: Uint32Array | null = null;

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? CRC32_POLYNOMIAL_REVERSED ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
}

function crc32(bytes: Uint8Array): number {
  const table = (crcTable ??= buildCrcTable());
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ (table[(crc ^ (bytes[i] as number)) & 0xff] as number);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Nombres
// ---------------------------------------------------------------------------

const utf8 = new TextEncoder();

function utf8Length(text: string): number {
  return utf8.encode(text).length;
}

function splitPdfStem(fileName: string): string {
  return fileName.toLowerCase().endsWith(PDF_EXTENSION)
    ? fileName.slice(0, -PDF_EXTENSION.length)
    : fileName;
}

/**
 * Nombre con el que un documento entra en el ZIP: el original saneado más
 * {@link SIGNED_NAME_SUFFIX}. No resuelve colisiones — eso es del escritor,
 * que es quien sabe qué nombres ya están ocupados.
 */
export function zipEntryNameFor(originalName: string): string {
  // 1. Sólo el nombre base: cualquier componente de ruta (incluido `..`) se
  //    descarta, así que nada puede escribir fuera del destino al extraer.
  const base = originalName.split(/[\\/]/).pop() ?? '';

  // 2. Fuera lo que Windows no admite, y los puntos/espacios del final (que
  //    Windows recorta en silencio, provocando colisiones invisibles).
  let stem = stripControlChars(splitPdfStem(base))
    .replace(FORBIDDEN_NAME_CHARS, '_')
    .replace(/[\s.]+$/u, '')
    .trim();

  if (stem.length === 0) stem = FALLBACK_STEM;

  // 3. Los dispositivos DOS están reservados también con extensión (`CON.pdf`),
  //    y la reserva mira sólo lo anterior al primer punto.
  const firstSegment = stem.split('.')[0] ?? '';
  if (WINDOWS_RESERVED_NAMES.has(firstSegment.toUpperCase())) stem = `_${stem}`;

  // 4. Recorte por BYTES UTF-8, quitando caracteres completos: cortar el array
  //    de bytes partiría una ñ o un emoji y dejaría un nombre inválido.
  const fixedBytes = utf8Length(SIGNED_NAME_SUFFIX + PDF_EXTENSION);
  const chars = [...stem];
  while (chars.length > 1 && utf8Length(chars.join('')) + fixedBytes > MAX_ENTRY_NAME_BYTES) {
    chars.pop();
  }

  return `${chars.join('')}${SIGNED_NAME_SUFFIX}${PDF_EXTENSION}`;
}

// ---------------------------------------------------------------------------
// Estructuras del ZIP
// ---------------------------------------------------------------------------

/** Fecha/hora en el formato DOS de 16+16 bits que usa el ZIP (APPNOTE §4.4.6). */
function toDosDateTime(when: Date): { time: number; date: number } {
  // El formato DOS arranca en 1980 y no admite nada anterior: un reloj mal
  // puesto no debe producir un ZIP inválido.
  const year = Math.max(1980, when.getFullYear());
  const time =
    (when.getHours() << 11) | (when.getMinutes() << 5) | (Math.floor(when.getSeconds() / 2) & 0x1f);
  const date = ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  return { time, date };
}

interface EntryRecord {
  readonly nameBytes: Uint8Array;
  readonly crc: number;
  readonly size: number;
  readonly offset: number;
  readonly dosTime: number;
  readonly dosDate: number;
}

function buildLocalHeader(entry: EntryRecord): Uint8Array {
  const out = new Uint8Array(LOCAL_HEADER_BYTES + entry.nameBytes.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, SIG_LOCAL_HEADER, true);
  view.setUint16(4, VERSION_STORE, true);
  view.setUint16(6, FLAG_UTF8_NAMES, true);
  view.setUint16(8, METHOD_STORE, true);
  view.setUint16(10, entry.dosTime, true);
  view.setUint16(12, entry.dosDate, true);
  view.setUint32(14, entry.crc, true);
  view.setUint32(18, entry.size, true); // comprimido == sin comprimir en `store`
  view.setUint32(22, entry.size, true);
  view.setUint16(26, entry.nameBytes.length, true);
  view.setUint16(28, 0, true); // sin campo extra
  out.set(entry.nameBytes, LOCAL_HEADER_BYTES);
  return out;
}

function buildCentralHeader(entry: EntryRecord): Uint8Array {
  const out = new Uint8Array(CENTRAL_HEADER_BYTES + entry.nameBytes.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, SIG_CENTRAL_HEADER, true);
  // "Versión creada por" con byte alto 0 = MS-DOS/FAT: es la combinación que
  // ningún extractor interpreta como permisos POSIX que no tenemos.
  view.setUint16(4, VERSION_STORE, true);
  view.setUint16(6, VERSION_STORE, true);
  view.setUint16(8, FLAG_UTF8_NAMES, true);
  view.setUint16(10, METHOD_STORE, true);
  view.setUint16(12, entry.dosTime, true);
  view.setUint16(14, entry.dosDate, true);
  view.setUint32(16, entry.crc, true);
  view.setUint32(20, entry.size, true);
  view.setUint32(24, entry.size, true);
  view.setUint16(28, entry.nameBytes.length, true);
  view.setUint16(30, 0, true); // extra
  view.setUint16(32, 0, true); // comentario
  view.setUint16(34, 0, true); // disco inicial
  view.setUint16(36, 0, true); // atributos internos
  view.setUint32(38, 0, true); // atributos externos
  view.setUint32(42, entry.offset, true);
  out.set(entry.nameBytes, CENTRAL_HEADER_BYTES);
  return out;
}

function buildEndOfCentralDir(count: number, dirSize: number, dirOffset: number): Uint8Array {
  const out = new Uint8Array(END_OF_CENTRAL_DIR_BYTES);
  const view = new DataView(out.buffer);
  view.setUint32(0, SIG_END_OF_CENTRAL_DIR, true);
  view.setUint16(4, 0, true); // nº de disco
  view.setUint16(6, 0, true); // disco del directorio central
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, dirSize, true);
  view.setUint32(16, dirOffset, true);
  view.setUint16(20, 0, true); // sin comentario
  return out;
}

// ---------------------------------------------------------------------------
// Estimación previa y guarda
// ---------------------------------------------------------------------------

/** Tamaño que ocupará el ZIP de un lote, a partir de los tamaños de ENTRADA. */
export function estimateSignedZipBytes(inputSizes: readonly number[]): number {
  let total = END_OF_CENTRAL_DIR_BYTES;
  for (const size of inputSizes) {
    total += size + SIGNATURE_GROWTH_ALLOWANCE_BYTES + PER_ENTRY_OVERHEAD_BYTES;
  }
  return total;
}

function megabytes(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

/**
 * Rechaza, **antes de firmar nada**, el lote que no cabría en el ZIP.
 *
 * Se llama antes de abrir la sesión de firma a propósito: descubrir el problema
 * a mitad del lote significaría haber gastado PIN, PKCS#7 y llamadas a la TSA
 * para no poder entregar el resultado.
 *
 * @throws {BatchZipCapacityError} con la causa y la acción concreta (dividir).
 */
export function assertBatchFitsZip(files: readonly { readonly size: number }[]): void {
  if (files.length > ZIP_MAX_ENTRIES) {
    throw new BatchZipCapacityError(
      'zip_too_many_entries',
      `El lote tiene ${files.length} documentos y un ZIP admite como máximo ${ZIP_MAX_ENTRIES}. ` +
        'Divide el lote.',
    );
  }
  const sizes = files.map((f) => f.size);
  const estimated = estimateSignedZipBytes(sizes);
  if (estimated <= MAX_ZIP_TOTAL_BYTES) return;

  const averagePerDoc = estimated / Math.max(1, files.length);
  const perBatch = Math.max(1, Math.floor(MAX_ZIP_TOTAL_BYTES / averagePerDoc));
  throw new BatchZipCapacityError(
    'zip_total_too_large',
    `El lote ocuparía ~${megabytes(estimated)} MB una vez firmado y el ZIP de descarga admite ` +
      `hasta ${megabytes(MAX_ZIP_TOTAL_BYTES)} MB (se construye completo en memoria, sin ` +
      'guardarse directamente en disco). Divide el lote en tandas de ' +
      `~${perBatch} archivo${perBatch === 1 ? '' : 's'} y firma cada tanda por separado.`,
  );
}

// ---------------------------------------------------------------------------
// Escritor incremental
// ---------------------------------------------------------------------------

/** Una entrada ya escrita en el ZIP. */
export interface BatchZipEntry {
  /** Nombre final dentro del ZIP (saneado y sin colisiones). */
  readonly name: string;
  /** Nombre tal como lo trajo el usuario. */
  readonly originalName: string;
  readonly bytes: number;
}

export interface BatchZipWriterOptions {
  /** Tope propio de este ZIP. Sólo para tests; producción usa el de por defecto. */
  readonly maxTotalBytes?: number;
  /** Reloj para la fecha de las entradas. Inyectable para tests reproducibles. */
  readonly now?: () => Date;
}

/** Forma del búfer interno, para el test de "no acumula". */
export interface BatchZipBufferShape {
  readonly entries: number;
  /** Bytes de payload que el escritor retiene como array en el heap JS. */
  readonly heapArrayBytes: number;
  /** El array del heap más grande que retiene (una cabecera, no un PDF). */
  readonly maxHeapArrayBytes: number;
  /** Bytes de cabecera acumulados: esto sí crece con N, y son decenas por entrada. */
  readonly headerBytes: number;
  /** Payloads llevados a almacenamiento de Blob (fuera del heap). */
  readonly blobParts: number;
}

/**
 * Escribe un ZIP en modo `store` entrada por entrada.
 *
 * Uso previsto: una instancia por lote, `addPdf` desde `onItemSigned` de
 * `runBatchSign` (que espera la promesa, así que el backpressure de la cola
 * sigue vigente) y `finish()` al terminar.
 *
 * **Memoria**: cada PDF se traslada a un `Blob` en cuanto entra, así que sale
 * del heap de JS (el navegador lo gestiona aparte y puede volcarlo a disco). El
 * escritor no retiene ni la referencia al array que le pasan — quien llame puede
 * reutilizar su búfer en cuanto `addPdf` retorna. Lo único que crece con el
 * número de documentos son las cabeceras: ~76 bytes + el nombre, dos veces.
 */
export class BatchZipWriter {
  readonly #maxTotalBytes: number;
  readonly #now: () => Date;
  /** Partes del archivo en orden. Los payloads van como `Blob`, no como array. */
  readonly #parts: (Blob | Uint8Array)[] = [];
  readonly #records: EntryRecord[] = [];
  readonly #entries: BatchZipEntry[] = [];
  /** Nombre en minúsculas → nº de la próxima variante, porque Windows y macOS
   *  no distinguen mayúsculas y `Informe.pdf` pisaría a `informe.pdf`. */
  readonly #takenNames = new Map<string, number>();
  #offset = 0;
  #headerBytes = 0;
  #finished = false;

  constructor(options: BatchZipWriterOptions = {}) {
    this.#maxTotalBytes = options.maxTotalBytes ?? MAX_ZIP_TOTAL_BYTES;
    this.#now = options.now ?? (() => new Date());
  }

  /** Entradas escritas, en orden. */
  get entries(): readonly BatchZipEntry[] {
    return this.#entries;
  }

  /** Bytes escritos hasta ahora, sin contar el directorio central pendiente. */
  get byteLength(): number {
    return this.#offset;
  }

  /**
   * Añade un PDF firmado. Devuelve el nombre con el que quedó dentro del ZIP.
   *
   * @throws {BatchZipCapacityError} si esta entrada rebasaría el tope. Es la red
   * de seguridad de {@link assertBatchFitsZip} para cuando la estimación previa
   * se quedó corta (firmas que crecieron más de lo reservado). Lanzado desde
   * `onItemSigned`, la cola lo registra como `deliveryError` conservando los
   * bytes firmados: el documento está firmado y no se pierde.
   */
  addPdf(originalName: string, pdf: Uint8Array): string {
    if (this.#finished) {
      throw new Error('El ZIP ya está cerrado: no se pueden añadir más documentos.');
    }
    if (this.#entries.length >= ZIP_MAX_ENTRIES) {
      throw new BatchZipCapacityError(
        'zip_too_many_entries',
        `Un ZIP admite como máximo ${ZIP_MAX_ENTRIES} documentos. Divide el lote.`,
      );
    }

    const name = this.#resolveUniqueName(zipEntryNameFor(originalName));
    const nameBytes = utf8.encode(name);
    const growth =
      LOCAL_HEADER_BYTES +
      nameBytes.length +
      pdf.byteLength +
      CENTRAL_HEADER_BYTES +
      nameBytes.length +
      END_OF_CENTRAL_DIR_BYTES;
    const projected = this.#offset + this.#centralDirBytes() + growth;
    if (projected > this.#maxTotalBytes || projected > ZIP_FORMAT_MAX_BYTES) {
      throw new BatchZipCapacityError(
        'zip_total_too_large',
        `El ZIP llegaría a ~${megabytes(projected)} MB y el tope es ` +
          `${megabytes(this.#maxTotalBytes)} MB. Divide el lote y firma por tandas.`,
      );
    }

    const { time, date } = toDosDateTime(this.#now());
    const record: EntryRecord = {
      nameBytes,
      crc: crc32(pdf),
      size: pdf.byteLength,
      offset: this.#offset,
      dosTime: time,
      dosDate: date,
    };

    const header = buildLocalHeader(record);
    this.#parts.push(header);
    this.#headerBytes += header.byteLength;
    // `new Blob([pdf])` COPIA los bytes al almacenamiento de Blob del navegador:
    // salen del heap de JS y quien llamó recupera su búfer para reutilizarlo.
    this.#parts.push(new Blob([pdf as unknown as BlobPart] as BlobPart[]));
    this.#offset += header.byteLength + pdf.byteLength;
    this.#records.push(record);
    this.#entries.push({ name, originalName, bytes: pdf.byteLength });
    return name;
  }

  /** Cierra el archivo (directorio central + EOCD) y devuelve el `Blob`. */
  finish(): Blob {
    if (!this.#finished) {
      const dirOffset = this.#offset;
      let dirSize = 0;
      for (const record of this.#records) {
        const central = buildCentralHeader(record);
        this.#parts.push(central);
        this.#headerBytes += central.byteLength;
        dirSize += central.byteLength;
      }
      const eocd = buildEndOfCentralDir(this.#records.length, dirSize, dirOffset);
      this.#parts.push(eocd);
      this.#headerBytes += eocd.byteLength;
      this.#offset += dirSize + eocd.byteLength;
      this.#finished = true;
    }
    // `Uint8Array` es genérico desde TS 5.7 (`Uint8Array<ArrayBufferLike>`) y ya
    // no encaja en `BlobPart`, que exige un búfer respaldado por `ArrayBuffer`.
    // En runtime un `Uint8Array` SIEMPRE es una parte válida de `Blob`: el
    // desajuste es del tipado de la lib, no del comportamiento.
    return new Blob(this.#parts as unknown as BlobPart[], { type: ZIP_MIME_TYPE });
  }

  /**
   * Semilla de test: clasifica lo que el escritor RETIENE, para poder afirmar
   * que ningún PDF se queda en el heap y que eso no cambia con el tamaño del
   * lote. Sin esta ventana, "no acumula" sería una afirmación sin verificar
   * (mismo patrón que `__setP12CopyObserverForTests` en `sign-queue.ts`).
   */
  __debugBufferShapeForTests(): BatchZipBufferShape {
    let heapArrayBytes = 0;
    let maxHeapArrayBytes = 0;
    let blobParts = 0;
    const payloadSizes = new Set(this.#records.map((r) => r.size));
    for (const part of this.#parts) {
      if (part instanceof Blob) {
        blobParts += 1;
        continue;
      }
      const bytes = (part as Uint8Array).byteLength;
      // Un array retenido cuyo tamaño coincide con un payload es exactamente el
      // fallo que este test persigue: un PDF que se quedó en el heap.
      if (payloadSizes.has(bytes)) {
        heapArrayBytes += bytes;
      }
      maxHeapArrayBytes = Math.max(maxHeapArrayBytes, bytes);
    }
    return {
      entries: this.#entries.length,
      heapArrayBytes,
      maxHeapArrayBytes,
      headerBytes: this.#headerBytes,
      blobParts,
    };
  }

  #centralDirBytes(): number {
    let total = 0;
    for (const record of this.#records) {
      total += CENTRAL_HEADER_BYTES + record.nameBytes.length;
    }
    return total;
  }

  #resolveUniqueName(candidate: string): string {
    const key = candidate.toLowerCase();
    const next = this.#takenNames.get(key);
    if (next === undefined) {
      this.#takenNames.set(key, 2);
      return candidate;
    }
    const stem = splitPdfStem(candidate);
    for (let variant = next; ; variant++) {
      const attempt = `${stem} (${variant})${PDF_EXTENSION}`;
      const attemptKey = attempt.toLowerCase();
      if (!this.#takenNames.has(attemptKey)) {
        this.#takenNames.set(key, variant + 1);
        this.#takenNames.set(attemptKey, 2);
        return attempt;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Integración con la cola de firma
// ---------------------------------------------------------------------------

/** Por qué un documento del lote NO está dentro del ZIP. */
export type BatchZipExclusionReason = 'needs_review' | 'failed' | 'delivery_error' | 'cancelled';

export interface BatchZipExclusion {
  readonly id: string;
  /** Nombre original, para que la UI pueda señalar el documento concreto. */
  readonly originalName: string;
  readonly reason: BatchZipExclusionReason;
  /** Motivo estable (código de error, razón de la revisión). */
  readonly detail?: string;
}

export interface BatchZipResult {
  /** El ZIP listo para descargar. Contiene ÚNICAMENTE PDFs firmados. */
  readonly zip: Blob;
  readonly entries: readonly BatchZipEntry[];
  /** Lo que quedó fuera y por qué. Vacío no significa "todo perfecto": mira `batch`. */
  readonly excluded: readonly BatchZipExclusion[];
  /** Resultado íntegro del lote (incluye la degradación por documento). */
  readonly batch: RunBatchSignResult;
}

function exclusionFor(item: BatchQueueItem): BatchZipExclusion | null {
  if (item.status === 'needs_review') {
    return {
      id: item.id,
      originalName: item.file.name,
      reason: 'needs_review',
      ...(item.needsReview ? { detail: item.needsReview.reason } : {}),
    };
  }
  if (item.status === 'failed') {
    return {
      id: item.id,
      originalName: item.file.name,
      reason: 'failed',
      ...(item.error ? { detail: item.error.code } : {}),
    };
  }
  if (item.status === 'cancelled') {
    // El usuario paró el lote. Se enumera igual que el resto: un documento que
    // no está en el ZIP y no aparece en `excluded` es un documento perdido en
    // silencio, que es justo lo que esta lista existe para impedir.
    return { id: item.id, originalName: item.file.name, reason: 'cancelled' };
  }
  return null;
}

/**
 * Firma el lote y entrega los PDFs firmados en un solo ZIP.
 *
 * Orden deliberado: primero {@link assertBatchFitsZip} (rechazo sin gastar una
 * sola firma), luego `runBatchSign` con un `onItemSigned` que escribe cada
 * documento en el ZIP a medida que sale — la cola espera esa escritura, así que
 * su backpressure se mantiene y nunca hay más de un PDF firmado vivo.
 *
 * Los `needs_review` y los fallidos NO entran en el ZIP (no hay PDF firmado que
 * meter) y se devuelven en {@link BatchZipResult.excluded} con su motivo. Un
 * documento firmado cuya escritura al ZIP falló sale como `delivery_error`: sus
 * bytes siguen en `batch.items[].result`, así que el llamante puede reintentar.
 *
 * @throws {BatchZipCapacityError} si el lote no cabe (antes de firmar nada).
 */
export async function signBatchToZip(
  files: File[],
  p12: ArrayBuffer,
  pin: string,
  opts: Omit<BatchSignOptions, 'onItemSigned'> = {},
): Promise<BatchZipResult> {
  assertBatchFitsZip(files);

  const writer = new BatchZipWriter();
  const written = new Set<string>();

  const batch = await runBatchSign(files, p12, pin, {
    ...opts,
    onItemSigned: (item) => {
      writer.addPdf(item.file.name, item.result.signedPdf);
      written.add(item.id);
    },
  });

  const excluded: BatchZipExclusion[] = [];
  for (const item of batch.items) {
    const exclusion = exclusionFor(item);
    if (exclusion) {
      excluded.push(exclusion);
      continue;
    }
    if (item.status === 'done' && !written.has(item.id)) {
      excluded.push({
        id: item.id,
        originalName: item.file.name,
        reason: 'delivery_error',
        ...(item.deliveryError ? { detail: item.deliveryError.code } : {}),
      });
    }
  }

  return { zip: writer.finish(), entries: writer.entries, excluded, batch };
}
