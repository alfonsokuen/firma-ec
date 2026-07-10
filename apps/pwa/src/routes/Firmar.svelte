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
import '../styles/guided.css';
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
  // Suppress the centered default while we wait for the anti-overlap scan when
  // the document already carries signatures; otherwise keep the legacy default.
  autoPlaceDefault = detected.length === 0;
  currentStep = 2;
}

// ── Step 2 — Smart (anti-overlap) initial placement ──────────────────
// v0.15.3 — PdfPreview scans prior signature widgets after load. If the doc
// carries VISIBLE signatures we drop the new box in a free slot beside them
// (defaulting to the page where others signed), so co-signers don't overlap
// and the user needs zero drags in the common case.
function onSignaturesScanned(scan: { widgets: ExistingSigRect[]; pageDims: PageDim[] }): void {
  // Respect a box the user already placed.
  if (boxPos) {
    autoPlaceDefault = true;
    return;
  }
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
  // Either way, re-enable the centered default: it is a no-op once boxPos is
  // set, and the correct fallback when no visible prior signature was found.
  autoPlaceDefault = true;
}

// v0.4.0 — when navigating in via /share or /handle-file, the PDF was
// pre-loaded by SharedFileHandler into sessionStorage. Pull it on mount and
// jump straight to step 2 (skip Drop UI). consume() is idempotent: subsequent
// mounts (e.g. via "Sign another PDF") see no payload.
onMount(async () => {
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
    // Wipe sensitive in-memory refs ASAP.
    pin = '';
    pfxParsed = null;
    currentStep = 6;
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
  currentStep = 1;
  pdf = null;
  pageInfo = null;
  currentPage = 0;
  boxPos = null;
  autoPlaceDefault = true;
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
  if (currentStep === 5) return signing ? t('firmar.step6.signing') : t('firmar.step6.cta');
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
          class="self-start text-xs font-medium text-ink-500 underline underline-offset-2"
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
            <h2 id="guided-welcome-title" class="font-display font-semibold text-xl mb-1">
              {t('guided.start.title')}
            </h2>
            <p class="text-sm text-ink-600 dark:text-ink-300 mb-1">
              {t('guided.start.subtitle')}
            </p>
            <p class="text-sm text-ink-600 dark:text-ink-300">
              {t('guided.voz.bienvenida')}
            </p>
            <button type="button" class="guided-start-btn" onclick={onStart}>
              {t('guided.start.cta')}
            </button>
          </div>
        {:else}
          {#if guided}
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
          {/if}
          <Drop onselect={onPdfSelect} onerror={onPdfPickError} />
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
              defaultLastPage
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
          {/if}
          <DropP12 onp12={onP12} onerror={onP12Error} />
        {/if}
      </div>
    {:else if currentStep === 4}
      <div class="flex flex-col gap-4">
        {#if guided}
          <GuideNarrator voiceKey={pinError ? 'pin_error' : 'pin'} autoOnMount />
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
      {/if}
      <DownloadResult
        signedPdfBlob={signedPdf}
        originalName={pdf.name}
        signatureCount={pdf.detectedSignatures.length + 1}
        timestamp={lastTimestamp}
        ltv={lastLtv}
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
    background: var(--brand-500);
    color: white;
    border: none;
  }
  .guided-start-btn:hover {
    background: var(--brand-600);
  }
</style>
