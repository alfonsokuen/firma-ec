<script lang="ts">
import {
  type ExistingSignature,
  type ParsedPfx,
  SignerError,
  detectSignatures,
} from '@firma-ec/signer';
/**
 * Firmar.svelte — F3 wizard orchestrator (6 steps; el paso "Detalles
 * opcionales" se removió en v0.7.15).
 *
 * Pipeline:
 *   1. Drop PDF              → detectSignatures pre-flight (multi-firma awareness)
 *   2. Place signature box   → PdfPreview + BoxPlacer (+ ExistingSignaturesPanel)
 *   3. Drop .p12             → DropP12 + parsePfx (extracts CN + validity)
 *   4. PIN                   → PinInput (own CTA "Verificar contraseña")
 *   5. Summary               → SignSummary + "Firmar PDF" CTA
 *   6. Download              → DownloadResult or ErrorState
 *
 * Crypto stays in workers. Two single-shot workers:
 *   - p12.worker (parsePfx for CN + validity preview after PIN entry)
 *   - sign.worker (actual signing, re-parses PFX inside its own heap)
 * Both are terminated immediately after use to satisfy the single-shot
 * security model. Main thread NEVER runs forge.pkcs12 — keeps UI responsive
 * on mid-tier mobile during 3DES legacy decrypt (1–3s).
 *
 * Cleanup-on-back from step 4: PIN is forced empty + retype banner.
 *
 * Error mapping: SignerError codes → i18n keys + UI flow (block step or reset).
 */
import { onDestroy, onMount } from 'svelte';
import { link } from 'svelte-spa-router';
import '../styles/guided.css';
import { clearSavedStep, getSavedStep, saveStep } from '../lib/guiado/resume.ts';
import { speak, speakAuto, stop as stopVoice } from '../lib/guiado/voice.svelte.ts';
import {
  fetchSourcePdf,
  isHandoffActive,
  isUrlAllowed,
  parseHandoffParams,
} from '../lib/handoff.ts';
import { type UIKey, t, tp } from '../lib/i18n.svelte.ts';
import { getSettings, updateSettings } from '../lib/settings.svelte.ts';
import { consume as consumeIncomingPdf } from '../lib/sharedFile.ts';
import { pingUsage } from '../lib/statsBeacon.ts';
// F-mobile-perf: parsePfx now runs in a dedicated worker (off main thread)
// so the UI stays responsive while forge.pkcs12FromAsn1 chews on 3DES legacy
// PFX. Mid-tier mobile improvement: ~1–3s of frozen UI eliminated.
import { P12WorkerError, parsePfxInWorker } from '../lib/workers/p12-bus.ts';
import {
  type LtvMeta,
  type SignProgressStage,
  type TimestampMeta,
  WorkerSignerError,
  runSign,
} from '../lib/workers/sign-bus.ts';

import {
  type EnginePlacementMeta,
  engineRotateFor,
  fromEnginePlacement,
  isUiSpaceSafe,
} from '../lib/batch/manualPlacement.ts';
import {
  PreflightSessionError,
  computeSignSessionTimeoutMs,
  openPreflightSession,
} from '../lib/batch/preflight-bus.ts';
import Drop from '../ui/Drop.svelte';
import BoxPlacer from '../ui/firma/BoxPlacer.svelte';
import CertHelp from '../ui/firma/CertHelp.svelte';
import DownloadResult from '../ui/firma/DownloadResult.svelte';
import DropP12 from '../ui/firma/DropP12.svelte';
import ExistingSignaturesPanel from '../ui/firma/ExistingSignaturesPanel.svelte';
import PdfPreview from '../ui/firma/PdfPreview.svelte';
import PinInput from '../ui/firma/PinInput.svelte';
import SignSummary from '../ui/firma/SignSummary.svelte';
import SimplePlacer from '../ui/firma/SimplePlacer.svelte';
import WhatsAppSticky from '../ui/firma/WhatsAppSticky.svelte';
import WizardProgress from '../ui/firma/WizardProgress.svelte';
import WizardShell from '../ui/firma/WizardShell.svelte';
import {
  DEFAULT_SIG_BOX_H,
  DEFAULT_SIG_BOX_W,
  type ExistingSigRect,
  type PageDim,
  computeSmartPlacement,
} from '../ui/firma/smartPlacement.ts';
import GuideHelp from '../ui/guiado/GuideHelp.svelte';
import GuideMascot from '../ui/guiado/GuideMascot.svelte';
import GuideNarrator from '../ui/guiado/GuideNarrator.svelte';

// ── Types ────────────────────────────────────────────────────────────
interface PdfState {
  bytes: Uint8Array;
  name: string;
  size: number;
  detectedSignatures: ExistingSignature[];
}
interface BoxPos {
  page: number; // 1-based
  x: number;
  y: number;
  w: number;
  h: number;
}
interface PageInfo {
  pageIndex: number; // 0-based
  pdfWidth: number;
  pdfHeight: number;
  cssWidth: number;
  cssHeight: number;
}
interface PfxState {
  bytes: Uint8Array;
  fileName: string;
}

type ErrKind = 'pdf' | 'p12' | 'pin' | 'sign' | 'cert';
interface UiError {
  kind: ErrKind;
  /** i18n key for title. */
  titleKey: UIKey;
  /** i18n key for body. */
  bodyKey: UIKey;
  /** Date for {date} interp. */
  dateInterp?: string;
  /** Raw code for telemetry. */
  code?: string;
}

// ── State (Svelte 5 runes) ───────────────────────────────────────────
const TOTAL = 6;
const STEPS = [
  { id: 's1', labelKey: 'firmar.step1.title' as UIKey },
  { id: 's2', labelKey: 'firmar.step2.title' as UIKey },
  { id: 's3', labelKey: 'firmar.step3.title' as UIKey },
  { id: 's4', labelKey: 'firmar.step4.title' as UIKey },
  { id: 's5', labelKey: 'firmar.step6.title' as UIKey },
  { id: 's6', labelKey: 'firmar.step7.success_title' as UIKey },
];

// F1 modo guiado — prop de entrada; default false = diff nulo en el camino
// estándar. Aún no cambia render (llegará por fase con renderers guiados).
let { guided = false }: { guided?: boolean } = $props();

let currentStep = $state<number>(1);
let pdf = $state<PdfState | null>(null);
let pageInfo = $state<PageInfo | null>(null);
let currentPage = $state<number>(0);
let boxPos = $state<BoxPos | null>(null);
// v0.15.3 — while true, BoxPlacer may auto-place its centered default. We set
// it false when the PDF has prior signatures, until the anti-overlap scan
// resolves (then re-enable so a no-visible-widget result still gets a default).
let autoPlaceDefault = $state<boolean>(true);
/**
 * Lo que decidió el motor, conservado aparte de `boxPos` porque `BoxPosition`
 * no tiene dónde llevar el `/Rotate` (ver `fromEnginePlacement`) y hay que
 * devolvérselo al firmante: sin él, la estampa se dibuja derecha sobre una
 * página girada.
 *
 * `page` (1-based) es la GUARDA: el `rotate` solo vale mientras la caja siga en
 * la página que el motor eligió. En cuanto la persona la lleva a otra, ese
 * número describe una página distinta y deja de aplicarse.
 */
let autoPlacement = $state<EnginePlacementMeta | null>(null);
/**
 * Generacion del analisis en vuelo. Se fija al despachar `runAutoPlacement` y
 * avanza con cada PDF nuevo: un resultado que llega tarde -- la persona volvio
 * al paso 1 y solto otro documento -- comprueba su generacion y no toca nada.
 * Sin esto, la caja del documento ANTERIOR podia aterrizar sobre el nuevo.
 */
let placementRun = 0;
/**
 * `true` mientras el motor decide. Es el candado de la precedencia: con el
 * puesto, ni el anti-solape de `onSignaturesScanned` ni el default centrado de
 * BoxPlacer (via `autoPlaceDefault`) colocan nada. Sin este candado la
 * colocacion era una CARRERA -- en desktop ganaba el motor y en un movil lento
 * ganaba el camino viejo, que quedaba exactamente igual de ciego que antes.
 */
let enginePending = $state<boolean>(false);
/** Escaneo de widgets llegado con el motor aun pendiente; el fallback lo usa si el motor declina. */
let pendingScan: { widgets: ExistingSigRect[]; pageDims: PageDim[] } | null = null;
/**
 * ¿Llego ya el escaneo anti-solape de este documento? `scanSignatureWidgets`
 * corre UNA sola vez por carga (PdfPreview.svelte), asi que esto pasa a `true`
 * y no vuelve atras hasta el siguiente PDF.
 *
 * Es la pieza que le falta al gate de abajo para no dejar el paso 2 sin caja:
 * suprimir el default centrado solo tiene sentido MIENTRAS se espera a ese
 * escaneo. Una vez llego —haya colocado o no— nadie mas va a reactivarlo.
 */
let scanSeen = false;
/**
 * Sesion de analisis EN VUELO. Un PDF nuevo (o "firmar otro") la termina en el
 * acto: sin esto, cada ida-y-vuelta por el paso 1 dejaba un worker vivo hasta
 * agotar su timeout (60 s max), cada uno con su copia del documento a cuestas.
 */
let liveAnalysis: ReturnType<typeof openPreflightSession> | null = null;
// F1 modo guiado — paso 3: true tras "Sí, lo tengo" en CertHelp (muestra el
// DropP12 estándar). Reset en cada entrada nueva a step 3 (ver onBoxConfirm /
// onBack / onSignAgain) para que la pre-pregunta reaparezca cada vez.
let certConfirmed = $state<boolean>(false);
// F2 fix A — modo guiado, sub-estado LOCAL del paso 1 (no es un currentStep
// nuevo): antes de pulsar "Empezar" se muestra la tarjeta de bienvenida; el
// click en "Empezar" es el gesto real de usuario que desbloquea el audio
// (`speak()` setea `audioUnlocked=true` en voice.svelte.ts) y revela el Drop
// normal. En modo estándar (`guided === false`) esto no se usa nunca.
let started = $state<boolean>(false);
// F3 pulido — "retomar donde ibas": paso alcanzado en una sesión guiada
// previa (localStorage, SOLO el número — nunca PDF/.p12/PIN). null hasta
// que onMount lo lee (o si no hay nada guardado / no aplica).
let resumeStep = $state<number | null>(null);
let pfx = $state<PfxState | null>(null);
let pin = $state<string>('');
let pfxParsed = $state<ParsedPfx | null>(null);
let pinError = $state<string | null>(null);
let pinValidating = $state<boolean>(false);
let retypePinBanner = $state<boolean>(false);
let razon = $state<string>('');
let lugar = $state<string>('');
let signing = $state<boolean>(false);
let signStage = $state<SignProgressStage | null>(null);
let signedPdf = $state<Uint8Array | null>(null);
let lastTimestamp = $state<TimestampMeta | null>(null);
let lastLtv = $state<LtvMeta | null>(null);
// F1 — chain-completeness signal from the AIA fallback (see DownloadResult.svelte).
let lastChainComplete = $state<boolean | null>(null);
let lastMissingIssuerDn = $state<string | null>(null);
let uiError = $state<UiError | null>(null);

// ── Handoff (opt-in via ?handoff=1) ──────────────────────────────────
// When a trusted intake app deep-links us with `src` (act URL) + `cb`
// (callback URL), we FETCH the act, sign it on-device, and POST the signed
// bytes back to `cb`. Both URLs must be allow-listed (anti-SSRF). This works
// inside WhatsApp's in-app browser, where window.opener / popups fail.
// Without ?handoff=1 this stays false and the public flow is unchanged.
let handoffMode = $state<boolean>(false);
let handoffCallbackUrl = $state<string | null>(null);

// Lock-down derived: no need to be reactive elsewhere
const signerCN = $derived(pfxParsed?.signingCert.subjectCN ?? '');
const signerValidUntil = $derived(pfxParsed?.signingCert.notAfter ?? null);
const signerIssuer = $derived(pfxParsed?.signingCert.issuerCN ?? '');

// ── Step 1 — modo guiado: gesto "Empezar" ───────────────────────────
// F2 fix A — el único trabajo de este botón es (a) disparar `speak()` con
// un gesto real de click (desbloquea el autoplay) y (b) revelar el Drop.
// Nunca bloquea el flujo: si el usuario no quiere oír voz, igual avanza.
function onStart(): void {
  void speak('bienvenida');
  started = true;
}

// F3 pulido — "retomar donde ibas". Ninguna de las dos opciones salta el
// flujo (el PDF/.p12/PIN nunca se guardan): ambas simplemente confirman que
// el aviso se leyó. La única diferencia real es si el contador de paso
// previo se conserva o se borra explícitamente.
function onResumeContinue(): void {
  resumeStep = null;
}
function onResumeRestart(): void {
  clearSavedStep();
  resumeStep = null;
}

// ── Step 1 — Drop PDF ────────────────────────────────────────────────
async function onPdfSelect(file: File): Promise<void> {
  uiError = null;
  let buf: ArrayBuffer;
  try {
    buf = await file.arrayBuffer();
  } catch {
    uiError = {
      kind: 'pdf',
      titleKey: 'firmar.error.bad_pdf.title',
      bodyKey: 'firmar.error.bad_pdf.body',
    };
    return;
  }
  const u8 = new Uint8Array(buf);
  let detected: ExistingSignature[] = [];
  try {
    detected = await detectSignatures(u8);
  } catch {
    // Pre-flight detect is best-effort; signal nothing if it fails.
    detected = [];
  }
  pdf = {
    bytes: u8,
    name: file.name,
    size: u8.byteLength,
    detectedSignatures: detected,
  };
  currentPage = 0;
  boxPos = null;
  autoPlacement = null;
  liveAnalysis?.terminate();
  liveAnalysis = null;
  placementRun += 1;
  pendingScan = null;
  scanSeen = false;
  enginePending = true;
  // Se suprime SIEMPRE el default centrado: ahora hay una decisión asíncrona
  // pendiente para todo documento, no solo para los que ya traen firmas. El
  // mismo patrón que ya usaba el escaneo anti-solape — `autoPlaceDefault`
  // vuelve a `true` en cuanto el motor contesta, acierte o falle.
  autoPlaceDefault = false;
  currentStep = 2;
  // La COPIA para el analizador se hace DENTRO de runAutoPlacement (su
  // `analyze()` transfiere el buffer y `pdf.bytes` se reutiliza para la vista
  // previa y para firmar); asi un OOM al duplicar un PDF de 50 MB cae en su
  // catch en vez de tragarse el drop entero sin error.
  void runAutoPlacement(u8, placementRun);
  // F3 pulido — conecta el clip `pdf_ok` (pendiente de F2): confirma la
  // carga al pasar de paso 1 a 2. `onPdfSelect` corre una sola vez por
  // archivo elegido, así que no hace falta guard de reentrada extra.
  if (guided) void speakAuto('pdf_ok');
}

// ── Step 2 — Colocación automática con el motor completo ─────────────
/**
 * Resuelve dónde va la firma con el MISMO motor que usa el lote
 * (`analyzePdfForPlacement` + `computeAutoPlacement`): campo de firma declarado
 * → anti-solape → hueco reservado / espacio libre → pie, todo contra las bandas
 * de texto reales. Hasta ahora este flujo colocaba sin mirar el texto.
 *
 * Corre en el worker de pre-vuelo, no en la hebra principal: `readTextBands` es
 * síncrono y bloquearía el render de la vista previa.
 *
 * No lanza nunca. Cualquier fallo —worker caído, documento ilegible, o un
 * `needs_review` legítimo— degrada al comportamiento anterior reactivando
 * `autoPlaceDefault`. Aquí NO se puede apartar el documento como hace el lote:
 * hay una persona delante y su trabajo es colocar la caja a mano.
 */
async function runAutoPlacement(bytes: Uint8Array, run: number): Promise<void> {
  // La creación de la sesión va DENTRO del try: `new Worker(...)` puede lanzar
  // síncrono (CSP / worker-src). Fuera, el rechazo escapaba por el `void` del
  // llamante y `enginePending`/`autoPlaceDefault` quedaban clavados — paso 2
  // sin caja, sin default centrado y sin error, para siempre.
  let session: ReturnType<typeof openPreflightSession> | null = null;
  try {
    session = openPreflightSession();
    liveAnalysis = session;
    // Techo propio: esto es una SUGERENCIA con fallback valido, no la firma.
    // El presupuesto por defecto (15 s + 1 ms/KB, tope 60 s) es de firma; aqui
    // con una persona mirando se corta antes y se cae al camino de siempre.
    const outcome = await session.analyze(new Uint8Array(bytes), {
      timeoutMs: Math.min(computeSignSessionTimeoutMs(bytes.byteLength), 20_000),
    });
    // Resultado de un PDF que ya no está cargado: no toca nada. El `finally`
    // tampoco (mismo guard) — el run nuevo gestiona su propio estado.
    if (run !== placementRun) return;
    // Una caja ya puesta manda. Con los colocadores automáticos gateados por
    // `enginePending`, una caja aquí solo puede haberla puesto la PERSONA
    // (tap/arrastre), y su decisión no se pisa.
    if (boxPos) return;
    // Guarda de espacio de coordenadas (misma que el colocador manual del
    // lote): el rect del motor viene en puntos PDF ABSOLUTOS y sin rotar,
    // pero esta UI pinta y firma en el espacio del viewport de pdf.js — ya
    // rotado y con origen en el CropBox. Coinciden SOLO con `/Rotate` 0 y
    // CropBox en el origen; en cualquier otra pagina el preview mentiria
    // (caja dibujada en un sitio, `/Rect` en otro). Ahi se declina al camino
    // de siempre — mismo statu quo que antes de esta rama — hasta que la UI
    // aprenda esos espacios (el defecto D1/D2 ya documentado en
    // `pageGeometry.ts`, fuera de este alcance).
    const uiSpaceSafe =
      outcome.status === 'ready' &&
      outcome.placement !== undefined &&
      isUiSpaceSafe(outcome.geometry?.find((g) => g.page === outcome.placement?.page));
    if (outcome.status === 'ready' && outcome.placement && uiSpaceSafe) {
      const pos = fromEnginePlacement(outcome.placement);
      boxPos = pos;
      autoPlacement = {
        ...pos,
        ...(outcome.placement.rotate !== undefined ? { rotate: outcome.placement.rotate } : {}),
      };
      // El motor razona sobre TODO el documento, no solo la última página:
      // hay que ir a donde decidió (`075-2026` firma en la 2 y la 3, no al final).
      currentPage = outcome.placement.page;
    } else {
      // El motor declinó (`needs_review` / ilegible), no dio rect (`ready`
      // sin `placement`: "que decida el firmante", que aquí no analiza), o la
      // página no es segura para esta UI: cae el fallback de SIEMPRE —
      // anti-solape junto a firmas previas si el escaneo las vio. La cascada
      // queda determinista: persona > motor > anti-solape > centrado.
      //
      // Se loguea solo el CODIGO (nunca nombre de archivo ni bytes — regla de
      // privacidad del producto, mismo precedente que `preflight.ts`): es el
      // unico canal que distingue "documento dificil" de "infraestructura
      // rota" (p.ej. chunk del worker 404 tras un deploy).
      const why =
        outcome.status === 'ready'
          ? outcome.placement
            ? 'page_space_unsafe'
            : 'ready_without_rect'
          : (outcome.reason ?? outcome.status);
      console.warn(`[firmar] auto-placement declined: ${why}`);
      applySmartFallback();
    }
  } catch (e) {
    // Solo para el run VIGENTE: un run abandonado (PDF nuevo o "firmar otro"
    // terminaron su sesion a proposito) rechaza tarde con 'timeout', y
    // logear ese aborto como fallo contaminaria justo el canal que existe
    // para distinguir "infra rota" de "documento dificil".
    if (run === placementRun) {
      // Solo el codigo del error — cero contenido del documento. Sin esta
      // linea, un deploy que rompa el worker degradaria a TODOS los usuarios
      // al camino ciego sin dejar rastro ni en DevTools.
      console.error(
        `[firmar] auto-placement failed: ${e instanceof PreflightSessionError ? e.code : 'unknown'}`,
      );
      applySmartFallback();
    }
  } finally {
    session?.terminate();
    if (liveAnalysis === session) liveAnalysis = null;
    if (run === placementRun) {
      enginePending = false;
      // Mismo gate que v0.15.3: el default centrado solo vuelve si hay caja o
      // si el documento NO trae firmas previas. Sin esta condicion, un motor
      // que declina ANTES de que llegue el escaneo (el orden normal: el
      // analisis se despacha antes de montar la vista previa) soltaba el
      // centrado sobre la ultima pagina y el anti-solape ya nunca corria.
      // Con firmas detectadas y sin caja, quien reactiva es
      // `onSignaturesScanned` al colocar (o al no poder colocar).
      // En GUIADO se reactiva SIEMPRE: el escaneo que este gate espera
      // (`onSignaturesScanned`) solo esta cableado al PdfPreview del camino
      // estandar — SimplePlacer trae el suyo propio, y su sugerencia
      // (`placeAtBottomLastPage`) ya esquiva las firmas previas con ese
      // escaneo local. Sin el `guided ||`, un documento firmado cuyo motor
      // declina dejaba el modo guiado sin caja y con el CTA deshabilitado
      // para siempre (HIGH del QA dual, reproducido con carta-arrendamiento).
      autoPlaceDefault =
        guided || boxPos !== null || (pdf?.detectedSignatures.length ?? 0) === 0 || scanSeen;
    }
  }
}

/**
 * El camino previo al motor (v0.15.3): colocación anti-solape junto a las
 * firmas visibles previas. Solo se llama cuando el motor declinó y con el
 * escaneo que llegó mientras pensaba — nunca compite con él.
 */
function applySmartFallback(): void {
  const scan = pendingScan;
  pendingScan = null;
  if (!scan || boxPos) return;
  placeFromScan(scan);
  // Aqui NO se toca `autoPlaceDefault`: este metodo se llama desde el `try` y
  // desde el `catch` de `runAutoPlacement`, y el `finally` corre despues y
  // pisaria el valor. Quien decide es el gate del `finally` — via `scanSeen`.
}

// ── Step 2 — Smart (anti-overlap) initial placement ──────────────────
// v0.15.3 — PdfPreview scans prior signature widgets after load. If the doc
// carries VISIBLE signatures we drop the new box in a free slot beside them
// (defaulting to the page where others signed), so co-signers don't overlap
// and the user needs zero drags in the common case.
function onSignaturesScanned(scan: { widgets: ExistingSigRect[]; pageDims: PageDim[] }): void {
  scanSeen = true;
  if (enginePending) {
    // El motor aún decide: guardar el escaneo y NO colocar nada. Sin este
    // gate, quien acabara primero (motor vs escaneo) decidía la colocación —
    // y en un dispositivo lento el camino viejo ganaba la carrera y el
    // resultado del motor se descartaba en silencio.
    pendingScan = scan;
    return;
  }
  // Respect a box the user already placed.
  if (boxPos) {
    autoPlaceDefault = true;
    return;
  }
  placeFromScan(scan);
  // Either way, re-enable the centered default: it is a no-op once boxPos is
  // set, and the correct fallback when no visible prior signature was found.
  autoPlaceDefault = true;
}

function placeFromScan(scan: { widgets: ExistingSigRect[]; pageDims: PageDim[] }): void {
  const placement = computeSmartPlacement({
    existing: scan.widgets,
    pageDims: scan.pageDims,
    defaultW: DEFAULT_SIG_BOX_W,
    defaultH: DEFAULT_SIG_BOX_H,
  });
  if (placement) {
    // Trade-off: defaultLastPage already jumped the preview to the last page;
    // if the signatures live elsewhere this re-jump is visible — accepted,
    // since landing where the co-signers signed IS the desired destination.
    currentPage = placement.page - 1; // 0-based for PdfPreview
    boxPos = placement;
  }
}

// v0.4.0 — when navigating in via /share or /handle-file, the PDF was
// pre-loaded by SharedFileHandler into sessionStorage. Pull it on mount and
// jump straight to step 2 (skip Drop UI). consume() is idempotent: subsequent
// mounts (e.g. via "Sign another PDF") see no payload.
// F3 pulido — persiste SOLO el número de paso en modo guiado (nunca en el
// wizard estándar). Se limpia al terminar de firmar (onSignNow) y al
// "Empezar de nuevo" (onSignAgain / onResumeRestart).
$effect(() => {
  if (guided) saveStep(currentStep);
});

onMount(async () => {
  if (guided) resumeStep = getSavedStep();
  // ── Handoff mode (opt-in): deep-link with `src` (act URL) + `cb` (callback
  // URL). We FETCH the source act from `src` (anti-SSRF: only allow-listed
  // origins) and feed it through the EXACT same onPdfSelect() path a
  // hand-picked file uses. The callback URL is stashed for DownloadResult. A
  // failure here surfaces a clear error but never breaks the public flow. ──
  if (isHandoffActive()) {
    handoffMode = true;
    const { src, cb } = parseHandoffParams();
    // Only keep an allow-listed callback; a non-allowed cb is dropped so the
    // "Enviar firmado" CTA falls back to a plain local download.
    handoffCallbackUrl = cb && isUrlAllowed(cb) ? cb : null;

    if (src && isUrlAllowed(src)) {
      try {
        const file = await fetchSourcePdf(src);
        await onPdfSelect(file); // identical to a manual drop
      } catch (_) {
        // Fetch/parse failed: show a clear, non-fatal error. The wizard stays
        // at step 1 so the user can still pick a PDF manually.
        uiError = {
          kind: 'pdf',
          titleKey: 'firmar.error.bad_pdf.title',
          bodyKey: 'firmar.error.bad_pdf.body',
        };
      }
    } else if (src) {
      // src present but not allow-listed → refuse to fetch (anti-SSRF) and tell
      // the user, without breaking the manual flow.
      uiError = {
        kind: 'pdf',
        titleKey: 'firmar.error.bad_pdf.title',
        bodyKey: 'firmar.error.bad_pdf.body',
      };
    }
    // In handoff mode we don't also pull a shared/OS file.
    return;
  }

  const incoming = consumeIncomingPdf();
  if (incoming) {
    // Synthesize a File-like flow: reuse onPdfSelect for parity with manual drop.
    try {
      // Cast: BlobPart in lib.dom expects ArrayBuffer; our Uint8Array view
      // is structurally compatible at runtime. The narrow ArrayBufferLike
      // mismatch is a TS-only concern.
      const file = new File([incoming.bytes as unknown as Uint8Array<ArrayBuffer>], incoming.name, {
        type: 'application/pdf',
      });
      await onPdfSelect(file);
    } catch (_) {
      // If File construction fails (very old browser) just fall through to
      // the empty wizard — user can pick manually.
    }
  }
});

function onPdfPickError(
  key: 'verificar.error_too_large' | 'verificar.error_not_pdf' | 'verificar.error_read',
): void {
  uiError = {
    kind: 'pdf',
    titleKey: 'firmar.error.bad_pdf.title',
    bodyKey:
      key === 'verificar.error_too_large'
        ? 'firmar.error.pdf_too_large.body'
        : 'firmar.error.bad_pdf.body',
  };
}

// ── Step 2 — Box placement ───────────────────────────────────────────
function onPageRender(info: {
  pageIndex: number;
  cssWidth: number;
  cssHeight: number;
  pdfWidth: number;
  pdfHeight: number;
}): void {
  pageInfo = info;
  // If we don't have a box yet, leave it null — user must tap to place.
  // If we have a box on a *different* page, keep it (page tracked separately).
}

/**
 * v0.4.6 — when entering step 2 on mobile (<768px), auto-scroll the PDF
 * stage into view so users don't have to manually scroll past the wizard
 * progress bar to reach the BoxPlacer. Desktop already shows everything.
 */
$effect(() => {
  if (currentStep === 2 && pageInfo && typeof window !== 'undefined' && window.innerWidth < 768) {
    requestAnimationFrame(() => {
      const stage = document.querySelector('.pdf-stage-host');
      if (stage) {
        stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }
});

function onBoxConfirm(pos: BoxPos): void {
  boxPos = pos;
  certConfirmed = false;
  currentStep = 3;
}

// ── Step 3 — Drop .p12 ───────────────────────────────────────────────
function onP12({ p12, fileName }: { p12: ArrayBuffer; fileName: string }): void {
  uiError = null;
  pfx = { bytes: new Uint8Array(p12), fileName };
  pfxParsed = null;
  pin = '';
  pinError = null;
  currentStep = 4;
}

function onP12Error(key: 'firmar.step3.error_too_large' | 'firmar.step3.error_not_p12'): void {
  uiError = {
    kind: 'p12',
    titleKey: 'firmar.error.bad_p12.title',
    bodyKey:
      key === 'firmar.step3.error_too_large'
        ? 'firmar.error.bad_p12.body'
        : 'firmar.error.bad_p12.body',
  };
}

// ── Step 4 — PIN ─────────────────────────────────────────────────────
async function onPinSubmit(): Promise<void> {
  if (!pfx || !pin || pinValidating) return;
  pinValidating = true;
  pinError = null;
  uiError = null;
  try {
    // Defensive copy: the worker transfers (detaches) pfxCopy.buffer, but
    // pfx.bytes must survive for the actual sign worker step later.
    const pfxCopy = new Uint8Array(pfx.bytes);
    const parsed = await parsePfxInWorker(pfxCopy.buffer, pin);
    pfxParsed = parsed;
    // Cert validity check (mirror worker policy in UI for fast feedback).
    const now = new Date();
    if (parsed.signingCert.notAfter.getTime() < now.getTime()) {
      uiError = {
        kind: 'cert',
        titleKey: 'firmar.error.cert_expired.title',
        bodyKey: 'firmar.error.cert_expired.body',
        dateInterp: parsed.signingCert.notAfter.toLocaleDateString(),
        code: 'cert_expired',
      };
      pfxParsed = null;
      return;
    }
    if (parsed.signingCert.notBefore.getTime() > now.getTime()) {
      uiError = {
        kind: 'cert',
        titleKey: 'firmar.error.cert_not_yet_valid.title',
        bodyKey: 'firmar.error.cert_not_yet_valid.body',
        dateInterp: parsed.signingCert.notBefore.toLocaleDateString(),
        code: 'cert_not_yet_valid',
      };
      pfxParsed = null;
      return;
    }
    // Don't keep the parsed.privateKeyJwk around longer than necessary.
    // We hold ParsedPfx for CN/validity preview but the worker uses its own pfx bytes + pin.
    // Move forward.
    retypePinBanner = false;
    currentStep = 5; // direct to confirm/sign (Detalles opcionales step removed v0.7.15)
  } catch (e) {
    // P12WorkerError preserves SignerError code via .code; treat both the same.
    const code = e instanceof SignerError || e instanceof P12WorkerError ? e.code : 'unknown';
    if (code === 'pin_invalid' || code === 'bad_pin') {
      // Surface the non-sensitive PIN-shape fingerprint (len/whitespace/ascii,
      // never the characters) appended by p12.worker, to diagnose a mobile-only
      // rejection of a correct password (e.g. an auto-inserted space).
      const detail = e instanceof Error ? e.message : '';
      const shape = detail.match(/\[pin shape:[^\]]*\]/)?.[0] ?? '';
      pinError = shape
        ? `${t('firmar.error.bad_pin.body')} ${shape}`
        : t('firmar.error.bad_pin.body');
    } else if (code === 'pfx_corrupt' || code === 'bad_p12') {
      uiError = {
        kind: 'p12',
        titleKey: 'firmar.error.bad_p12.title',
        bodyKey: 'firmar.error.bad_p12.body',
        code,
      };
    } else if (code === 'no_signing_cert') {
      uiError = {
        kind: 'p12',
        titleKey: 'firmar.error.no_signing_cert.title',
        bodyKey: 'firmar.error.no_signing_cert.body',
        code,
      };
    } else {
      uiError = {
        kind: 'pin',
        titleKey: 'firmar.error.unknown.title',
        bodyKey: 'firmar.error.unknown.body',
        code,
      };
    }
  } finally {
    pinValidating = false;
  }
}

// ── Step 5 — Optional attrs handled by component bind ────────────────

// ── Step 6 — Sign ────────────────────────────────────────────────────
async function onSignNow(): Promise<void> {
  if (!pdf || !pfx || !pin || !boxPos || signing) return;
  signing = true;
  signStage = null;
  uiError = null;
  // F2 fix B — narra al ENTRAR al estado "firmando". `onSignNow` solo corre
  // una vez por click (early-return de arriba si `signing` ya es true), así
  // que esto no puede disparar más de una vez por firma.
  if (guided) void speakAuto('firmando');
  try {
    // Defensive copies — runSign transfers the buffers, leaving them detached.
    const pdfBuf = pdf.bytes.buffer.slice(0) as ArrayBuffer;
    const pfxBuf = pfx.bytes.buffer.slice(0) as ArrayBuffer;
    const userSettings = getSettings();
    const runOpts: Parameters<typeof runSign>[3] = {
      signingTime: new Date(),
      visibleSig: {
        // BoxPlacer emits 1-based page (matches the user-visible "page N");
        // signer's validateVisibleSig expects 0-based — convert here.
        page: boxPos.page - 1,
        x: boxPos.x,
        y: boxPos.y,
        width: boxPos.w,
        height: boxPos.h,
        // `/Rotate` de la página, SOLO si la caja sigue siendo LA DEL MOTOR
        // (mismo rect, no solo misma página) — la guarda vive en
        // `engineRotateFor`, probada aparte.
        ...(() => {
          const rotate = engineRotateFor(autoPlacement, boxPos);
          return rotate !== undefined ? { rotate } : {};
        })(),
      },
      onProgress: (s) => {
        signStage = s;
      },
      // F6 §Task 16 — wire user settings into the worker request.
      timestampEnabled: userSettings.tsaEnabled,
      tsaUrl: userSettings.tsaUrl,
      tsaTimeoutMs: userSettings.tsaTimeoutMs,
      // F7 §T30 — wire LTV settings into the worker request.
      ltvEnabled: userSettings.ltvEnabled,
      ltvArchiveEnabled: userSettings.ltvArchiveEnabled,
      ltvTimeoutMs: userSettings.ltvTimeoutMs,
      ocspUrl: userSettings.ocspUrl,
    };
    if (razon) runOpts.reason = razon;
    if (lugar) runOpts.location = lugar;
    const result = await runSign(pdfBuf, pfxBuf, pin, runOpts);
    signedPdf = result.signedPdf;
    // Anonymous usage tally for the public landing counter (no PII / content).
    pingUsage('sign');
    // F6 §Task 16 — capture timestamp meta for badge + toast in step 7.
    lastTimestamp = result.timestamp;
    // F7 §T30 — capture LTV meta for the LtvBadge in step 7.
    lastLtv = result.ltv;
    // F1 — capture chain-completeness for the soft warning in step 7.
    lastChainComplete = result.chainComplete;
    lastMissingIssuerDn = result.missingIssuerDn ?? null;
    // Wipe sensitive in-memory refs ASAP.
    pin = '';
    pfxParsed = null;
    currentStep = 6;
    // F3 pulido — la firma terminó: ya no hay "donde retomar".
    if (guided) clearSavedStep();
  } catch (e) {
    mapAndSetSignError(e);
  } finally {
    signing = false;
    signStage = null;
  }
}

function mapAndSetSignError(e: unknown): void {
  const code = e instanceof WorkerSignerError ? e.code : 'unknown';
  switch (code) {
    case 'pin_invalid':
    case 'bad_pin':
      pinError = t('firmar.error.bad_pin.body');
      pin = '';
      currentStep = 4;
      retypePinBanner = false;
      return;
    case 'cert_expired':
      uiError = {
        kind: 'cert',
        titleKey: 'firmar.error.cert_expired.title',
        bodyKey: 'firmar.error.cert_expired.body',
        code,
      };
      return;
    case 'bad_pdf':
    case 'pdf_encrypted':
    case 'pdf_too_large':
      uiError = {
        kind: 'pdf',
        titleKey:
          code === 'pdf_encrypted'
            ? 'firmar.error.pdf_encrypted.title'
            : code === 'pdf_too_large'
              ? 'firmar.error.pdf_too_large.title'
              : 'firmar.error.bad_pdf.title',
        bodyKey:
          code === 'pdf_encrypted'
            ? 'firmar.error.pdf_encrypted.body'
            : code === 'pdf_too_large'
              ? 'firmar.error.pdf_too_large.body'
              : 'firmar.error.bad_pdf.body',
        code,
      };
      // Reset to step 1 so the user picks a different PDF
      currentStep = 1;
      pdf = null;
      return;
    case 'visible_sig_oob':
    case 'visible_sig_out_of_bounds':
    case 'visible_sig_invalid_page':
    case 'visible_sig_too_small':
      uiError = {
        kind: 'sign',
        titleKey: 'firmar.error.visible_sig_oob.title',
        bodyKey: 'firmar.error.visible_sig_oob.body',
        code,
      };
      currentStep = 2;
      return;
    case 'weak_alg':
      uiError = {
        kind: 'cert',
        titleKey: 'firmar.error.weak_alg.title',
        bodyKey: 'firmar.error.weak_alg.body',
        code,
      };
      return;
    case 'webcrypto_unsupported':
    case 'webcrypto_unsupported_alg':
      uiError = {
        kind: 'sign',
        titleKey: 'firmar.error.webcrypto_unsupported.title',
        bodyKey: 'firmar.error.webcrypto_unsupported.body',
        code,
      };
      return;
    case 'timeout':
      uiError = {
        kind: 'sign',
        titleKey: 'firmar.error.timeout.title',
        bodyKey: 'firmar.error.timeout.body',
        code,
      };
      return;
    default:
      uiError = {
        kind: 'sign',
        titleKey: 'firmar.error.sign_failed.title',
        bodyKey: 'firmar.error.sign_failed.body',
        code,
      };
  }
}

// ── Navigation ───────────────────────────────────────────────────────
function onBack(): void {
  stopVoice();
  if (currentStep <= 1) return;
  if (currentStep === 5 || currentStep === 6) {
    // Going back from 5 or 6 invalidates PIN — force retype.
    pin = '';
    pfxParsed = null;
    retypePinBanner = true;
    currentStep = 4;
    return;
  }
  if (currentStep === 4) {
    // Back from 4 to 3 — drop pfx altogether so user re-picks intentionally.
    pin = '';
    pinError = null;
    retypePinBanner = false;
    certConfirmed = false;
    currentStep = 3;
    return;
  }
  currentStep -= 1;
}

function onNext(): void {
  stopVoice();
  if (!canNext) return;
  if (currentStep === 1) return; // step 1 advances from onPdfSelect
  if (currentStep === 2) {
    if (boxPos) currentStep = 3;
    return;
  }
  if (currentStep === 3) return; // step 3 advances from onP12
  if (currentStep === 4) {
    void onPinSubmit();
    return;
  }
  if (currentStep === 5) {
    void onSignNow();
    return;
  }
}

function onSignAgain(): void {
  // Full reset.
  stopVoice();
  if (guided) clearSavedStep();
  resumeStep = null;
  currentStep = 1;
  pdf = null;
  pageInfo = null;
  currentPage = 0;
  boxPos = null;
  autoPlaceDefault = true;
  autoPlacement = null;
  liveAnalysis?.terminate();
  liveAnalysis = null;
  pendingScan = null;
  scanSeen = false;
  enginePending = false;
  placementRun += 1; // invalida cualquier analisis aun en vuelo
  started = false;
  certConfirmed = false;
  pfx = null;
  pin = '';
  pfxParsed = null;
  pinError = null;
  pinValidating = false;
  retypePinBanner = false;
  razon = '';
  lugar = '';
  signing = false;
  signStage = null;
  signedPdf = null;
  lastTimestamp = null;
  lastLtv = null;
  lastChainComplete = null;
  lastMissingIssuerDn = null;
  uiError = null;
}

// ── canNext per step ─────────────────────────────────────────────────
const canNext = $derived.by((): boolean => {
  switch (currentStep) {
    case 1:
      return false; // advances from drop callback
    case 2:
      return boxPos !== null;
    case 3:
      return false; // advances from drop callback
    case 4:
      return pin.length > 0 && !pinValidating;
    case 5:
      return !signing;
    default:
      return false;
  }
});

const nextLabel = $derived.by((): string | undefined => {
  // Step 4: el CTA "Verificar contraseña" vive en el footer (alineado con
  // "Atrás", misma fila) — PinInput ya no renderiza su propio botón.
  if (currentStep === 4) return t('firmar.step4.cta');
  if (currentStep === 5) {
    if (signing) return t('firmar.step6.signing');
    // Guiado: la voz dice "Firmar ahora" (guided.voz.confirmar) — el CTA debe
    // nombrar exactamente lo mismo. Modo estándar sigue con "Firmar PDF".
    return guided ? t('guided.confirm.cta') : t('firmar.step6.cta');
  }
  return undefined;
});

/** Steps 1, 3, 6 manage their own CTAs — hide the default footer. Step 2 in
 *  guided mode also manages its own CTA (SimplePlacer's "Sí, continuar"),
 *  which duplicated the standard footer's "Siguiente" — SimplePlacer renders
 *  its own "Atrás" affordance (via `onBack`) so back-navigation isn't lost. */
const hideFooter = $derived(
  currentStep === 1 || currentStep === 3 || currentStep === 6 || (currentStep === 2 && guided),
);

// BoxPlacer needs page-relative position; coerce 0-based PdfPreview pageIndex to 1-based.
const boxPosBound = $derived.by((): BoxPos | null => {
  if (!boxPos) return null;
  if (boxPos.page !== currentPage + 1) {
    // If page changed and no box on this one yet, hide it (keep stored).
    return null;
  }
  return boxPos;
});

function onBoxPositionChange(p: BoxPos | null): void {
  if (!p) return;
  boxPos = { ...p, page: currentPage + 1 };
}

// Cleanup on unmount: zero out PIN.
onDestroy(() => {
  stopVoice();
  // Tercera salida del analisis en vuelo (las otras dos: PDF nuevo y
  // "firmar otro"): salir de la ruta a media colocacion no debe dejar un
  // worker vivo con su copia del PDF hasta agotar su timeout.
  liveAnalysis?.terminate();
  liveAnalysis = null;
  pin = '';
  pfxParsed = null;
  // Handoff via deep-link/fetch holds no listener or window reference, so
  // there is nothing to tear down here (the callback URL is plain state).
});

// ── Stage label for sign progress ────────────────────────────────────
const stageLabel = $derived.by((): string => {
  const map: Record<string, UIKey> = {
    parse_p12: 'firmar.step6.stage.parse_pfx',
    parse_pdf: 'firmar.step6.stage.load_pdf',
    compute_hash: 'firmar.step6.stage.build_cms',
    sign: 'firmar.step6.stage.sign',
    // F6 §Task 16 — TSA request mid-sign; the worker emits this once.
    request_timestamp: 'firmar.step6.stage.request_timestamp',
    embed: 'firmar.step6.stage.assemble_pades',
    // F7 §T30 — LTV stages emitted around the signer call.
    fetch_ocsp: 'firmar.step6.stage.fetch_ocsp',
    fetch_crl: 'firmar.step6.stage.fetch_crl',
    build_dss: 'firmar.step6.stage.build_dss',
    document_timestamp: 'firmar.step6.stage.document_timestamp',
    done: 'firmar.step6.stage.assemble_pades',
  };
  if (!signStage) return t('firmar.step6.signing');
  const key = map[signStage];
  return key ? t(key) : t('firmar.step6.signing');
});

// Helper to interpolate body keys with optional date.
function bodyText(err: UiError): string {
  if (err.dateInterp) {
    return tp(err.bodyKey, { date: err.dateInterp });
  }
  return t(err.bodyKey);
}
</script>

<div data-guided={guided}>
<WizardShell
  {currentStep}
  totalSteps={TOTAL}
  canBack={currentStep > 1 && currentStep < 7}
  canNext={canNext}
  hideFooter={hideFooter}
  nextLabel={nextLabel}
  onBack={onBack}
  onNext={onNext}
>
  {#snippet header()}
    <div class="flex flex-col gap-3">
      <h1 class="text-2xl md:text-3xl font-display font-bold tracking-tight">
        {t('firmar.title')}
      </h1>
      {#if guided}
        <button
          type="button"
          class="self-start text-xs font-medium text-ink-600 dark:text-ink-400 underline underline-offset-2"
          onclick={() => updateSettings({ voiceAuto: !getSettings().voiceAuto })}
        >
          {getSettings().voiceAuto ? t('guided.voice.toggle_on') : t('guided.voice.toggle_off')}
        </button>
      {/if}
      <WizardProgress steps={STEPS} current={currentStep} />
    </div>
  {/snippet}

  {#snippet body()}
    {#if uiError}
      <div role="alert" class="rounded-2xl border border-err-500/40 bg-err-500/10 px-6 py-5 mb-6 flex items-start gap-3">
        <span class="i-lucide-alert-circle text-2xl text-err-500 shrink-0 mt-0.5" aria-hidden="true"></span>
        <div class="flex-1 min-w-0">
          <h2 class="font-display font-semibold text-err-500 mb-1">
            {t(uiError.titleKey)}
          </h2>
          <p class="text-ink-700 dark:text-ink-200 text-sm">
            {bodyText(uiError)}
          </p>
          {#if uiError.code}
            <p class="mt-2 text-xs font-mono text-ink-500">code: {uiError.code}</p>
          {/if}
        </div>
        <button
          type="button"
          onclick={() => (uiError = null)}
          aria-label={t('verificar.dismiss_demo')}
          class="shrink-0 w-9 h-9 rounded-md flex items-center justify-center text-ink-500 hover:bg-err-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-err-500"
        >
          <span class="i-lucide-x text-base" aria-hidden="true"></span>
        </button>
      </div>
    {/if}

    {#if currentStep === 1}
      <div class="flex flex-col gap-4">
        {#if guided && !started}
          <div class="guided-welcome" role="group" aria-labelledby="guided-welcome-title">
            <GuideMascot message={t('guided.mascot.welcome')} />
            <h2 id="guided-welcome-title" class="font-display font-semibold text-xl mb-1">
              {t('guided.start.title')}
            </h2>
            <p class="text-sm text-ink-600 dark:text-ink-300 mb-1">
              {t('guided.start.subtitle')}
            </p>
            <p class="text-sm text-ink-600 dark:text-ink-300">
              {t('guided.voz.bienvenida')}
            </p>
            {#if resumeStep && resumeStep > 1}
              <div class="guided-resume" role="group" aria-label={t('guided.resume.question')}>
                <p class="resume-question">{t('guided.resume.question')}</p>
                <p class="resume-body">{tp('guided.resume.body', { step: resumeStep })}</p>
                <div class="resume-actions">
                  <button type="button" class="btn-secondary" onclick={onResumeContinue}>
                    {t('guided.resume.yes')}
                  </button>
                  <button type="button" class="btn-secondary" onclick={onResumeRestart}>
                    {t('guided.resume.restart')}
                  </button>
                </div>
              </div>
            {/if}
            <button type="button" class="guided-start-btn" onclick={onStart}>
              {t('guided.start.cta')}
            </button>
          </div>
        {:else}
          {#if guided}
            <div>
              <h2 class="font-display font-semibold text-lg mb-1">
                {t('guided.step1.title')}
              </h2>
            </div>
            <GuideNarrator voiceKey="cargar_pdf" autoOnMount />
          {:else}
            <div>
              <h2 class="font-display font-semibold text-lg mb-1">
                {t('firmar.step1.title')}
              </h2>
              <p class="text-sm text-ink-600 dark:text-ink-300">
                {t('firmar.step1.subtitle')}
              </p>
            </div>
            <a
              href="/firmar-facil"
              use:link
              class="group inline-flex items-center gap-1.5 min-h-11 py-1.5 self-start text-sm font-medium text-brand-600 dark:text-brand-300 underline decoration-transparent hover:decoration-current underline-offset-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950 rounded"
            >
              <span class="i-lucide-volume-2 text-base shrink-0" aria-hidden="true"></span>
              <span>{t('firmar.try_guided')}</span>
            </a>
          {/if}
          <Drop
            onselect={onPdfSelect}
            onerror={onPdfPickError}
            label={guided ? t('guided.step1.drop_sub') : undefined}
            pickLabel={guided ? t('guided.step1.cta') : undefined}
            ariaLabel={guided ? t('guided.step1.cta') : undefined}
          />
        {/if}
      </div>
    {:else if currentStep === 2 && pdf}
      <div class="flex flex-col gap-4">
        <div>
          <h2 class="font-display font-semibold text-lg mb-1">
            {t(guided ? 'guided.placer.title' : 'firmar.step2.title')}
          </h2>
          {#if !guided}
            <p class="text-sm text-ink-600 dark:text-ink-300 sm:hidden">
              {t('firmar.step2.subtitle_mobile')}
            </p>
            <p class="text-sm text-ink-600 dark:text-ink-300 hidden sm:block">
              {t('firmar.step2.subtitle_desktop')}
            </p>
          {/if}
        </div>

        {#if enginePending}
          <p
            class="text-sm text-ink-500 dark:text-ink-400"
            role="status"
            aria-live="polite"
            data-testid="auto-searching"
          >
            {t('firmar.step2.auto_searching')}
          </p>
        {/if}

        {#if pdf.detectedSignatures.length > 0}
          <ExistingSignaturesPanel signatures={pdf.detectedSignatures} />
        {/if}

        {#if guided}
          <GuideNarrator voiceKey="ubicar_firma" autoOnMount />
          <SimplePlacer
            pdfBytes={pdf.bytes}
            signerCN={signerCN}
            bind:position={boxPos}
            onConfirm={onBoxConfirm}
            onBack={onBack}
            {autoPlaceDefault}
          />
        {:else}
          {#snippet pdfOverlay({ cssWidth, cssHeight }: { cssWidth: number; cssHeight: number })}
            {#if pageInfo}
              <BoxPlacer
                pdfPageSize={{ w: pageInfo.pdfWidth, h: pageInfo.pdfHeight }}
                canvasSize={{ w: cssWidth, h: cssHeight }}
                signerCN={signerCN}
                position={boxPosBound}
                onConfirm={onBoxConfirm}
                onChange={onBoxPositionChange}
                {autoPlaceDefault}
              />
            {/if}
          {/snippet}
          <div class="pdf-stage-host">
            <PdfPreview
              pdfBytes={pdf.bytes}
              bind:currentPage
              onPageRender={onPageRender}
              onSignaturesScanned={onSignaturesScanned}
              overlay={pdfOverlay}
              defaultLastPage={!autoPlacement}
            />
          </div>
        {/if}
      </div>
    {:else if currentStep === 3}
      <div class="flex flex-col gap-4">
        {#if guided && !certConfirmed}
          <GuideNarrator voiceKey="cert_pregunta" autoOnMount />
          <CertHelp
            onHave={() => (certConfirmed = true)}
            onNoHave={() => speakAuto('cert_no')}
          />
        {:else}
          <div>
            <h2 class="font-display font-semibold text-lg mb-1">
              {t('firmar.step3.title')}
            </h2>
            <p class="text-sm text-ink-600 dark:text-ink-300">
              {t('firmar.step3.privacy')}
            </p>
          </div>
          {#if guided}
            <GuideNarrator voiceKey="cargar_p12" autoOnMount />
            <GuideHelp summaryKey="guided.help.why" bodyKey="guided.help.cert" />
          {/if}
          <DropP12
            onp12={onP12}
            onerror={onP12Error}
            label={guided ? t('guided.cert.pick') : undefined}
            ariaLabel={guided ? t('guided.cert.pick') : undefined}
          />
        {/if}
      </div>
    {:else if currentStep === 4}
      <div class="flex flex-col gap-4">
        {#if guided}
          <GuideNarrator voiceKey={pinError ? 'pin_error' : 'pin'} autoOnMount />
          <GuideHelp summaryKey="guided.help.why" bodyKey="guided.help.pin" />
        {/if}
        <div>
          <h2 class="font-display font-semibold text-lg mb-1">
            {t('firmar.step4.title')}
          </h2>
          {#if retypePinBanner}
            <p class="text-sm text-warn-500 mt-1">
              {t('firmar.step4.retype_after_back')}
            </p>
          {/if}
        </div>
        <PinInput
          bind:value={pin}
          error={pinError}
          disabled={pinValidating}
          onsubmit={onPinSubmit}
        />
      </div>
    {:else if currentStep === 5 && pdf && boxPos}
      <div class="flex flex-col gap-4">
        {#if guided}
          <GuideNarrator voiceKey="confirmar" autoOnMount />
        {/if}
        <div>
          <h2 class="font-display font-semibold text-lg mb-1">
            {t('firmar.step6.title')}
          </h2>
        </div>
        <SignSummary
          pdf={{ name: pdf.name, size: pdf.size }}
          visibleSig={{ page: boxPos.page, x: boxPos.x, y: boxPos.y, w: boxPos.w, h: boxPos.h }}
          signerCN={signerCN || '—'}
          signingTime={new Date()}
          razon={razon}
          lugar={lugar}
        />
        {#if pdf.detectedSignatures.length > 0}
          <ExistingSignaturesPanel signatures={pdf.detectedSignatures} />
        {/if}
        {#if signing}
          <div class="rounded-xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 px-4 py-3">
            <p
              class="text-sm font-medium text-ink-700 dark:text-ink-200 flex items-center gap-2"
              aria-live="polite"
              aria-busy="true"
            >
              <span class="i-lucide-loader-2 text-base text-brand-500 animate-spin" aria-hidden="true"></span>
              {stageLabel}…
            </p>
            <p class="mt-1 text-xs text-ink-500 dark:text-ink-400">
              {t('firmar.step6.signing_hint')}
            </p>
          </div>
        {/if}
        {#if signerValidUntil}
          <p class="text-xs text-ink-500">
            {tp('firmar.step6.signer_issued_by', { issuer: signerIssuer || '—' })} · {tp('firmar.step6.signer_valid_until', { date: signerValidUntil.toLocaleDateString() })}
          </p>
        {/if}
      </div>
    {:else if currentStep === 6 && signedPdf && pdf}
      {#if guided}
        <GuideNarrator voiceKey="listo" autoOnMount />
        <div class="guided-done-mascot">
          <GuideMascot message={t('guided.mascot.done')} compact />
        </div>
      {/if}
      <DownloadResult
        signedPdfBlob={signedPdf}
        originalName={pdf.name}
        signatureCount={pdf.detectedSignatures.length + 1}
        timestamp={lastTimestamp}
        ltv={lastLtv}
        chainComplete={lastChainComplete}
        missingIssuerDn={lastMissingIssuerDn}
        onsignagain={onSignAgain}
        handoffMode={handoffMode}
        handoffCallbackUrl={handoffCallbackUrl}
        signerValidUntil={signerValidUntil}
      />
    {/if}
  {/snippet}
</WizardShell>
{#if guided}
  <WhatsAppSticky />
{/if}
</div>

<style>
  .pdf-stage-host {
    border-radius: var(--r-lg, 12px);
    overflow: hidden;
  }
  .guided-welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    text-align: center;
    padding: 1.5rem 1rem;
  }
  .guided-start-btn {
    margin-top: 0.75rem;
    min-height: 60px;
    min-width: 200px;
    padding: 0.75rem 2rem;
    border-radius: var(--r-lg, 12px);
    font-weight: 700;
    font-size: 1.05rem;
    cursor: pointer;
    /* AAA a11y (F3b): brand-500 con texto blanco no llega a 4.5:1
       (contraste medido 4.04:1 con axe-core color-contrast). brand-600 sí. */
    background: var(--brand-600);
    color: white;
    border: none;
  }
  .guided-start-btn:hover {
    background: oklch(38% 0.18 245);
  }
  .guided-resume {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.5rem;
    padding: 0.85rem 1rem;
    border-radius: var(--r-lg, 12px);
    border: 1px solid var(--ink-200, oklch(90% 0 0));
    background: var(--ink-50, oklch(97% 0 0));
    text-align: left;
  }
  .resume-question {
    font-weight: 700;
  }
  .resume-body {
    font-size: 0.9rem;
    color: var(--ink-600, oklch(45% 0 0));
  }
  .resume-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .guided-resume .btn-secondary {
    min-height: 48px;
    padding: 0.5rem 1rem;
    border-radius: var(--r-lg, 12px);
    font-weight: 600;
    cursor: pointer;
    background: transparent;
    border: 2px solid var(--ink-300, oklch(85% 0 0));
    color: var(--ink-700);
  }
  .guided-resume .btn-secondary:hover {
    background: var(--ink-100, oklch(95% 0 0));
  }
  .guided-done-mascot {
    max-width: 32rem;
    margin: 0 auto 1.25rem;
  }
  :global([data-theme='dark']) .guided-resume {
    background: var(--ink-900, oklch(20% 0 0));
    border-color: var(--ink-700, oklch(35% 0 0));
  }
</style>
