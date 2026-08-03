<script lang="ts">
/**
 * FirmarLote.svelte — firma por lotes: elegir varios PDFs, ver dónde caerá la
 * estampa en cada uno, firmarlos con una sola contraseña y bajar un ZIP.
 *
 * El orden de los pasos es la decisión de diseño que importa: la revisión de
 * colocación va ANTES del PIN. El motor decide la colocación mientras firma y
 * aparta lo que no admite un rect defendible; si eso se descubre al final, la
 * persona ya escribió su contraseña y ya esperó 20 minutos para enterarse de que
 * 30 documentos no salieron. Aquí lo sabe antes de decidir nada.
 *
 * Privacidad (invariante del proyecto): ni el nombre de un documento ni el PIN
 * ni la cédula del firmante salen de esta pantalla. No hay telemetría, no hay
 * logs con datos del usuario, y el PIN se borra en cuanto deja de hacer falta.
 */
import { onDestroy } from 'svelte';
import { push } from 'svelte-spa-router';
import {
  EFFECTIVE_MAX_FILES,
  type PreflightItem,
  type RejectedFile,
  acceptFiles,
  preflightBatch,
  toBatchInput,
} from '../lib/batch/preflight';
import {
  BatchZipCapacityError,
  type BatchZipResult,
  assertBatchFitsZip,
  signBatchToZip,
} from '../lib/export/batchZip';
import { type UIKey, getLang, t, tp } from '../lib/i18n.svelte.ts';
import { getSettings } from '../lib/settings.svelte.ts';
import { holdReload, releaseReload } from '../lib/swUpdate.svelte.ts';
import { type BatchQueueItem, MAX_BATCH_FILE_SIZE_BYTES } from '../lib/workers/sign-queue';
import DropP12 from '../ui/firma/DropP12.svelte';
import PinInput from '../ui/firma/PinInput.svelte';
import WizardProgress from '../ui/firma/WizardProgress.svelte';
import WizardShell from '../ui/firma/WizardShell.svelte';
import DropLote from '../ui/lote/DropLote.svelte';
import LoteList, { type LoteRow } from '../ui/lote/LoteList.svelte';

const STEPS: { id: string; labelKey: UIKey }[] = [
  { id: 'select', labelKey: 'lote.step.select' },
  { id: 'review', labelKey: 'lote.step.review' },
  { id: 'sign', labelKey: 'lote.step.sign' },
  { id: 'done', labelKey: 'lote.step.done' },
];

const lang = $derived(getLang());
$effect(() => {
  void lang;
});

// ---------- Estado ----------
let step = $state(1);

let files = $state<File[]>([]);
let rejected = $state<RejectedFile[]>([]);
let capacityError = $state<string | null>(null);

let preflight = $state<PreflightItem[]>([]);
let preflightRunning = $state(false);
/** Identifica la revisión en curso: solo ella puede escribir el estado. */
let preflightRun = 0;
let preflightAbort: AbortController | null = null;

let p12 = $state<ArrayBuffer | null>(null);
let p12Name = $state('');
let pin = $state('');
let p12Error = $state<string | null>(null);
let pinError = $state<string | null>(null);

let signing = $state(false);
let cancelling = $state(false);
let signAbort: AbortController | null = null;
/** Estado vivo por documento durante la firma, indexado por el id del motor. */
let liveItems = $state<BatchQueueItem[]>([]);

let result = $state<BatchZipResult | null>(null);
let zipUrl = $state<string | null>(null);
let downloaded = $state(false);
let fatalError = $state<string | null>(null);

// ---------- Derivados ----------
const maxSizeLabel = formatBytes(MAX_BATCH_FILE_SIZE_BYTES);

/** Documentos que el pre-flight dio por firmables — los únicos que van al motor. */
const signable = $derived(preflight.filter((i) => i.status === 'ready'));
const excludedByPreflight = $derived(preflight.filter((i) => i.status !== 'ready'));

const signedCount = $derived(liveItems.filter((i) => i.status === 'done').length);

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${Math.round(mb)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Traduce el motivo del motor; si es uno que no conocemos, lo muestra tal cual
 *  en vez de tragárselo — un motivo sin traducir informa más que ninguno. */
function reasonLabel(reason: string | undefined): string {
  if (!reason) return '';
  const key = `lote.review.reason.${reason}` as UIKey;
  const translated = t(key);
  return translated === key ? reason : translated;
}

/** Misma regla que reasonLabel: una fuente sin traducir se muestra tal cual
 *  en vez de desaparecer -- un mudo aquí es peor que un código feo. */
function sourceLabel(source: string | undefined): string {
  if (!source) return '';
  const key = `lote.review.source.${source}` as UIKey;
  const translated = t(key);
  return translated === key ? source : translated;
}

// ---------- Paso 1: selección ----------
function addFiles(incoming: File[]): void {
  capacityError = null;
  const { accepted, rejected: bad } = acceptFiles(incoming, files.length);
  if (accepted.length > 0) files = [...files, ...accepted];
  if (bad.length > 0) rejected = [...rejected, ...bad];
}

function removeFile(id: string): void {
  const index = Number(id.replace('sel-', ''));
  files = files.filter((_, i) => i !== index);
  capacityError = null;
}

function clearFiles(): void {
  files = [];
  rejected = [];
  capacityError = null;
}

const selectRows = $derived<LoteRow[]>(
  files.map((file, i) => ({
    id: `sel-${i}`,
    name: file.name,
    meta: formatBytes(file.size),
    tone: 'neutral' as const,
    removable: true,
  })),
);

// ---------- Paso 2: revisión de colocación ----------
async function goToReview(): Promise<void> {
  // El lote entero tiene que caber en un ZIP, y eso se sabe ANTES de firmar
  // nada: descubrirlo después significaría 50 documentos firmados que no se
  // pueden entregar.
  try {
    assertBatchFitsZip(files);
  } catch (e) {
    if (e instanceof BatchZipCapacityError) {
      capacityError = t('lote.reject.zip_too_large');
      return;
    }
    throw e;
  }

  // Cada entrada al paso 2 es una corrida con nombre propio. Sin esto, volver
  // atrás y entrar otra vez dejaba dos revisiones escribiendo sobre el mismo
  // estado: filas duplicadas, "Continuar" habilitado con la lista a medias, y
  // el mismo documento llegando dos veces al motor.
  const run = ++preflightRun;
  preflightAbort?.abort();

  step = 2;
  preflight = [];
  preflightRunning = true;
  preflightAbort = new AbortController();

  const report = await preflightBatch(files, {
    runId: `r${run}`,
    signal: preflightAbort.signal,
    onItem: (item) => {
      if (run !== preflightRun || !files.includes(item.file)) return;
      preflight = [...preflight, item];
    },
  });

  if (run !== preflightRun) return;
  // Y el informe final NO se vuelca tal cual: un documento que la persona quitó
  // mientras la revisión corría volvía a la lista como 'ready' y acababa
  // firmado dentro del ZIP. Manda la selección, no el informe.
  const stillSelected = new Set(files);
  preflight = report.items.filter((item) => stillSelected.has(item.file));
  preflightRunning = false;
}

function removeFromReview(id: string): void {
  const item = preflight.find((i) => i.id === id);
  preflight = preflight.filter((i) => i.id !== id);
  if (item) files = files.filter((f) => f !== item.file);
}

const reviewRows = $derived<LoteRow[]>(
  preflight.map((item) => ({
    id: item.id,
    name: item.file.name,
    meta:
      item.pageCount > 0
        ? // `item.page` viene en base 0 desde el motor; la persona cuenta desde 1.
          tp('lote.review.page_of', { p: item.page + 1, total: item.pageCount })
        : formatBytes(item.file.size),
    statusLabel:
      item.status === 'ready'
        ? t('lote.review.ready')
        : item.status === 'needs_review'
          ? t('lote.review.needs_review')
          : t('lote.review.unreadable'),
    detail: item.status === 'ready' ? sourceLabel(item.source) : reasonLabel(item.reason),
    tone: item.status === 'ready' ? 'ok' : item.status === 'needs_review' ? 'warn' : 'err',
    removable: true,
  })),
);

// ---------- Paso 3: certificado, PIN y firma ----------
function onP12({ p12: buf, fileName }: { p12: ArrayBuffer; fileName: string }): void {
  p12 = buf;
  p12Name = fileName;
  p12Error = null;
}

async function startSigning(): Promise<void> {
  if (!p12 || pin === '' || signing) return;

  signing = true;
  cancelling = false;
  pinError = null;
  fatalError = null;
  signAbort = new AbortController();
  liveItems = [];

  // Un lote de 50 documentos son minutos con la pestaña abierta. Sin esto, un
  // despliegue nuevo recarga la app a media firma y se pierde el trabajo.
  holdReload();

  // El PIN se copia para la llamada y se borra del estado del componente en el
  // mismo turno: a partir de aquí no vive en ningún sitio que sobreviva.
  const pinForRun = pin;
  pin = '';

  try {
    // Los ficheros y los rects que el pre-vuelo calculó para ellos salen de una
    // sola llamada: así no hay dos listas que puedan dejar de corresponderse. El
    // firmante no vuelve a analizar lo que esta pantalla acaba de analizar, y
    // —más importante— lo que se firma es exactamente lo que se enseñó.
    const { files, visibleSigByIndex } = toBatchInput(signable);
    // Los MISMOS ajustes que usa `/firmar`. Sin esto el lote no hereda lo que la
    // persona configuró y, peor, el motor cae a su TSA por defecto —el directo a
    // freetsa.org, que en navegador siempre falla por CORS—: un intento de red
    // desperdiciado por documento y un aviso de «sin sello» que asustaba
    // describiendo el perfil B-B que esta app produce a propósito.
    const userSettings = getSettings();
    const res = await signBatchToZip(files, p12, pinForRun, {
      // 'auto' sigue siendo el respaldo: cubre a cualquier documento cuyo rect
      // el pre-vuelo decidiera no publicar.
      visibleSig: 'auto',
      visibleSigByIndex,
      signal: signAbort.signal,
      timestampEnabled: userSettings.tsaEnabled,
      tsaUrl: userSettings.tsaUrl,
      tsaTimeoutMs: userSettings.tsaTimeoutMs,
      ltvEnabled: userSettings.ltvEnabled,
      ltvArchiveEnabled: userSettings.ltvArchiveEnabled,
      ltvTimeoutMs: userSettings.ltvTimeoutMs,
      ocspUrl: userSettings.ocspUrl,
      onItemUpdate: (item) => {
        const next = liveItems.filter((i) => i.id !== item.id);
        liveItems = [...next, { ...item }];
      },
    });

    result = res;
    zipUrl = URL.createObjectURL(res.zip);
    step = 4;
  } catch (e) {
    const code = (e as { code?: string })?.code ?? '';
    const message = (e as Error)?.message ?? '';
    if (code === 'bad_pin' || /pin|password|mac/i.test(message)) {
      pinError = t('lote.error.bad_pin');
    } else if (e instanceof BatchZipCapacityError) {
      fatalError = t('lote.reject.zip_too_large');
    } else {
      fatalError = t('lote.error.generic');
    }
  } finally {
    signing = false;
    cancelling = false;
    signAbort = null;
    releaseReload();
  }
}

function cancelSigning(): void {
  if (!signAbort || cancelling) return;
  cancelling = true;
  signAbort.abort();
}

const signRows = $derived<LoteRow[]>(
  signable.map((item) => {
    const live = liveItems.find((l) => l.file === item.file);
    const status = live?.status ?? 'pending';
    const key = `lote.sign.status.${status}` as UIKey;
    return {
      id: item.id,
      name: item.file.name,
      statusLabel: t(key),
      tone:
        status === 'done'
          ? ('ok' as const)
          : status === 'signing'
            ? ('busy' as const)
            : status === 'failed'
              ? ('err' as const)
              : status === 'needs_review'
                ? ('warn' as const)
                : ('neutral' as const),
    };
  }),
);

// ---------- Paso 4: resultado ----------
const doneTitle = $derived(
  result === null
    ? t('lote.done.title')
    : result.batch.succeeded === 0
      ? t('lote.done.title_none')
      : result.excluded.length > 0
        ? t('lote.done.title_partial')
        : t('lote.done.title'),
);

function exclusionLabel(reason: string): string {
  return t(`lote.done.excluded.${reason}` as UIKey);
}

/**
 * Mensaje técnico del motor, por documento. Un código a secas («no se pudo
 * firmar · incremental_update_failed») no deja a nadie —ni a quien firma ni a
 * quien recibe el reporte— averiguar QUÉ pasó. Los mensajes del firmante son
 * estructurales (hablan del PDF, no de su contenido), así que enseñarlos no
 * filtra nada del documento.
 */
const technicalDetail = $derived(
  new Map(
    (result?.batch.items ?? [])
      .filter((item) => item.error !== undefined)
      .map((item) => [item.id, item.error?.message ?? '']),
  ),
);

/**
 * Cuando lo que falla es la CARGA de un módulo de la propia app (un despliegue
 * nuevo que rotó los chunks con la pestaña abierta, o la caché del servidor de
 * desarrollo reconstruida debajo), el motor lo reporta documento a documento y
 * la lista acaba acusando a los PDFs de algo que no es suyo. Se nombra aparte:
 * el remedio —recargar— no tiene nada que ver con el documento.
 */
const appFailedToLoad = $derived(
  [...technicalDetail.values()].some((message) =>
    /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(message),
  ),
);

function restart(): void {
  revokeZip();
  // Una revisión en vuelo de la tanda anterior no debe repintar la nueva.
  preflightRun += 1;
  preflightAbort?.abort();
  preflightRunning = false;
  step = 1;
  files = [];
  rejected = [];
  preflight = [];
  liveItems = [];
  result = null;
  downloaded = false;
  fatalError = null;
  p12 = null;
  p12Name = '';
  pin = '';
  // Los avisos de la tanda anterior no valen para la nueva: dejarlos en pantalla
  // hace que la persona crea que ya falló algo antes de elegir un solo archivo.
  capacityError = null;
  p12Error = null;
  pinError = null;
}

function revokeZip(): void {
  if (zipUrl) {
    URL.revokeObjectURL(zipUrl);
    zipUrl = null;
  }
}

onDestroy(() => {
  preflightAbort?.abort();
  signAbort?.abort();
  // Si el componente muere a media firma, la retención tiene que soltarse o la
  // app deja de aceptar actualizaciones para siempre.
  if (signing) releaseReload();
  revokeZip();
  pin = '';
});

// ---------- Navegación ----------
function back(): void {
  if (step === 2) {
    preflightAbort?.abort();
    step = 1;
  } else if (step === 3) {
    step = 2;
  }
}

const canNext = $derived(
  step === 1 ? files.length > 0 : step === 2 ? !preflightRunning && signable.length > 0 : false,
);

const nextLabel = $derived(
  step === 1
    ? // Sin documentos el CTA está deshabilitado, pero "Revisar los 0" se lee
      // como un error de la app. El rótulo neutro dice lo mismo sin chirriar.
      files.length === 0
      ? t('firmar.next')
      : tp('lote.select.continue', { n: files.length })
    : signable.length === 1
      ? t('lote.review.continue_one')
      : tp('lote.review.continue', { n: signable.length }),
);

function next(): void {
  // Sin el `catch`, un fallo aquí rechaza una promesa sin dueño: la pantalla se
  // queda exactamente igual, sin mensaje y sin avanzar, y la persona vuelve a
  // pulsar creyendo que no registró el clic.
  if (step === 1) void goToReview().catch(() => (fatalError = t('lote.error.generic')));
  else if (step === 2) step = 3;
}
</script>

<svelte:head>
  <title>{t('lote.title')} — firmar.ec</title>
</svelte:head>

<WizardShell
  currentStep={step}
  totalSteps={STEPS.length}
  ariaLabel={t('lote.title')}
  canBack={step > 1 && !signing}
  {canNext}
  nextLabel={step <= 2 ? nextLabel : undefined}
  hideFooter={step >= 3}
  onBack={back}
  onNext={next}
>
  {#snippet header()}
    <WizardProgress steps={STEPS} current={step} />
    <h1 class="mt-4 text-2xl sm:text-3xl font-semibold tracking-tight text-ink-900 dark:text-ink-50">
      {step === 4 ? doneTitle : t('lote.title')}
    </h1>
    {#if step === 1}
      <p class="mt-2 text-sm text-ink-600 dark:text-ink-400 max-w-prose">
        {tp('lote.subtitle', { max: EFFECTIVE_MAX_FILES })}
      </p>
    {/if}
  {/snippet}

  {#snippet body()}
    <!-- ============ Paso 1 — elegir documentos ============ -->
    {#if step === 1}
      <div class="flex flex-col gap-5">
        <DropLote
          onfiles={addFiles}
          max={EFFECTIVE_MAX_FILES}
          {maxSizeLabel}
          compact={files.length > 0}
          disabled={files.length >= EFFECTIVE_MAX_FILES}
        />

        {#if rejected.length > 0}
          <div class="rounded-xl border-l-4 border-warn-500 bg-warn-500/10 px-4 py-3" role="alert">
            <p class="text-sm font-medium text-ink-800 dark:text-ink-100">
              {tp('lote.reject.title', { n: rejected.length })}
            </p>
            <ul class="mt-1.5 space-y-0.5">
              {#each rejected.slice(0, 5) as bad, i (bad.file.name + bad.reason + i)}
                <li class="text-xs text-ink-700 dark:text-ink-300 truncate">
                  <span class="font-medium">{bad.file.name}</span>
                  <span>
                    — {bad.reason === 'file_too_large'
                      ? tp('lote.reject.file_too_large', { size: maxSizeLabel })
                      : bad.reason === 'too_many'
                        ? tp('lote.reject.too_many', { max: EFFECTIVE_MAX_FILES })
                        : t(`lote.reject.${bad.reason}` as UIKey)}
                  </span>
                </li>
              {/each}
              {#if rejected.length > 5}
                <li class="text-xs text-ink-600 dark:text-ink-400">+{rejected.length - 5}</li>
              {/if}
            </ul>
            <button
              type="button"
              onclick={() => (rejected = [])}
              class="mt-2 h-11 px-3 -ml-3 text-xs font-medium text-ink-700 dark:text-ink-200 rounded-md hover:bg-warn-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {t('lote.reject.dismiss')}
            </button>
          </div>
        {/if}

        {#if capacityError}
          <p class="rounded-xl border-l-4 border-err-500 bg-err-500/10 px-4 py-3 text-sm text-ink-800 dark:text-ink-100" role="alert">
            {capacityError}
          </p>
        {/if}

        {#if files.length === 0}
          <div class="text-center py-6">
            <p class="text-base font-medium text-ink-700 dark:text-ink-200">
              {t('lote.select.empty_title')}
            </p>
            <p class="mt-1 text-sm text-ink-600 dark:text-ink-400">
              {t('lote.select.empty_body')}
            </p>
          </div>
        {:else}
          <div class="flex items-center justify-between gap-3">
            <p class="text-sm font-medium text-ink-700 dark:text-ink-200">
              {tp('lote.select.count', { n: files.length, max: EFFECTIVE_MAX_FILES })}
            </p>
            <button
              type="button"
              onclick={clearFiles}
              class="h-11 px-3 -mr-3 text-sm text-ink-600 dark:text-ink-400 rounded-md hover:text-err-500 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {t('lote.select.clear')}
            </button>
          </div>
          <LoteList rows={selectRows} onremove={removeFile} />
        {/if}
      </div>

    <!-- ============ Paso 2 — dónde va a quedar la firma ============ -->
    {:else if step === 2}
      <div class="flex flex-col gap-5">
        <div>
          <h2 class="text-lg font-semibold text-ink-900 dark:text-ink-50">
            {t('lote.review.title')}
          </h2>
          <p class="mt-1 text-sm text-ink-600 dark:text-ink-400 max-w-prose">
            {t('lote.review.subtitle')}
          </p>
        </div>

        {#if preflightRunning}
          <div
            class="flex items-center gap-3 rounded-xl bg-ink-100 dark:bg-ink-900 px-4 py-3"
            aria-live="polite"
          >
            <span class="i-lucide-loader-2 text-brand-500 spin-slow" aria-hidden="true"></span>
            <p class="text-sm text-ink-700 dark:text-ink-200 font-mono">
              {tp('lote.review.progress', { n: preflight.length, total: files.length })}
            </p>
          </div>
        {/if}

        {#if preflight.length > 0}
          <LoteList rows={reviewRows} onremove={removeFromReview} />
        {/if}

        {#if !preflightRunning && excludedByPreflight.length > 0}
          <p class="text-sm text-ink-700 dark:text-ink-300 rounded-xl border-l-4 border-warn-500 bg-warn-500/10 px-4 py-3">
            {tp('lote.review.excluded_note', { n: excludedByPreflight.length })}
          </p>
        {/if}

        {#if !preflightRunning && signable.length === 0 && preflight.length > 0}
          <p class="text-sm text-ink-800 dark:text-ink-100 rounded-xl border-l-4 border-err-500 bg-err-500/10 px-4 py-3" role="alert">
            {t('lote.review.all_excluded')}
          </p>
        {/if}
      </div>

    <!-- ============ Paso 3 — certificado, contraseña y firma ============ -->
    {:else if step === 3}
      <div class="flex flex-col gap-5">
        {#if !signing}
          <div>
            <h2 class="text-lg font-semibold text-ink-900 dark:text-ink-50">
              {t('lote.sign.title')}
            </h2>
            <p class="mt-1 text-sm text-ink-600 dark:text-ink-400 max-w-prose">
              {tp('lote.sign.subtitle', { n: signable.length })}
            </p>
          </div>

          {#if p12 === null}
            <DropP12 onp12={onP12} onerror={(key) => (p12Error = t(key))} />
            {#if p12Error}
              <p class="text-sm text-err-500" role="alert">{p12Error}</p>
            {/if}
          {:else}
            <div class="flex items-center gap-3 rounded-xl bg-ink-100 dark:bg-ink-900 px-4 py-3">
              <span class="i-lucide-shield-check text-brand-500" aria-hidden="true"></span>
              <p class="flex-1 min-w-0 truncate text-sm font-medium text-ink-800 dark:text-ink-100">
                {p12Name}
              </p>
              <button
                type="button"
                onclick={() => {
                  p12 = null;
                  p12Name = '';
                  pin = '';
                }}
                class="shrink-0 w-11 h-11 -mr-2 rounded-md flex items-center justify-center text-ink-500 hover:text-err-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                aria-label={t('firmar.back')}
              >
                <span class="i-lucide-x text-base" aria-hidden="true"></span>
              </button>
            </div>

            <PinInput bind:value={pin} error={pinError} onsubmit={startSigning} />

            <button
              type="button"
              onclick={startSigning}
              disabled={pin === ''}
              class="
                w-full h-12 rounded-md bg-brand-500 hover:bg-brand-600 active:scale-[0.98]
                text-white font-medium transition-all duration-100
                disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2
              "
              style="box-shadow: var(--shadow-rest);"
            >
              {tp('lote.sign.cta', { n: signable.length })}
            </button>
          {/if}
        {:else}
          <!-- Firmando -->
          <div>
            <h2 class="text-lg font-semibold text-ink-900 dark:text-ink-50">
              {t('lote.sign.running_title')}
            </h2>
            <p class="mt-1 text-sm text-ink-600 dark:text-ink-400">
              {t('lote.sign.running_body')}
            </p>
          </div>

          <div
            role="progressbar"
            aria-label={tp('lote.aria.progress', { n: signedCount, total: signable.length })}
            aria-valuenow={signedCount}
            aria-valuemin={0}
            aria-valuemax={signable.length}
            class="flex flex-col gap-2"
          >
            <p class="text-sm font-mono text-ink-700 dark:text-ink-200" aria-live="polite">
              {tp('lote.sign.progress', { done: signedCount, total: signable.length })}
            </p>
            <div class="h-1.5 w-full rounded-full bg-ink-200 dark:bg-ink-800 overflow-hidden">
              <div
                class="h-full bg-brand-500 rounded-full"
                style="width: {signable.length > 0
                  ? (signedCount / signable.length) * 100
                  : 0}%; transition: width var(--motion-state-lg) var(--motion-curve);"
              ></div>
            </div>
          </div>

          <button
            type="button"
            onclick={cancelSigning}
            disabled={cancelling}
            class="
              self-start h-12 px-5 rounded-md
              border border-ink-300 dark:border-ink-700
              bg-ink-50 dark:bg-ink-900 hover:bg-ink-100 dark:hover:bg-ink-800
              text-ink-700 dark:text-ink-100 font-medium transition-colors
              disabled:opacity-40 disabled:cursor-not-allowed
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
            "
          >
            {cancelling ? t('lote.sign.cancelling') : t('lote.sign.cancel')}
          </button>
        {/if}

        {#if fatalError}
          <p class="rounded-xl border-l-4 border-err-500 bg-err-500/10 px-4 py-3 text-sm text-ink-800 dark:text-ink-100" role="alert">
            {fatalError}
          </p>
        {/if}

        <LoteList rows={signRows} />
      </div>

    <!-- ============ Paso 4 — descargar ============ -->
    {:else if step === 4 && result}
      <div class="flex flex-col gap-5">
        <p class="text-sm text-ink-700 dark:text-ink-200">
          {result.batch.succeeded === 1
            ? t('lote.done.summary_one')
            : tp('lote.done.summary', { n: result.batch.succeeded })}
        </p>

        {#if zipUrl && result.batch.succeeded > 0}
          <a
            href={zipUrl}
            download="documentos-firmados.zip"
            onclick={() => (downloaded = true)}
            class="
              inline-flex items-center justify-center gap-2 w-full h-14 rounded-md
              bg-brand-500 hover:bg-brand-600 active:scale-[0.98]
              text-white font-medium text-base transition-all duration-100
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2
            "
            style="box-shadow: var(--shadow-rest);"
          >
            <span class="i-lucide-download text-lg" aria-hidden="true"></span>
            <span>{tp('lote.done.download', { size: formatBytes(result.zip.size) })}</span>
          </a>
          {#if downloaded}
            <p class="text-sm text-ink-600 dark:text-ink-400 text-center" aria-live="polite">
              {t('lote.done.downloaded')}
            </p>
          {/if}
        {/if}

        <!-- Lo firmado PERO degradado: válido hoy, frágil mañana. Callarlo sería
             el fallo silencioso que el motor se molestó en poder reportar. -->
        {#if result.batch.succeededDegraded > 0}
          <div class="rounded-xl border-l-4 border-warn-500 bg-warn-500/10 px-4 py-3">
            <p class="text-sm font-medium text-ink-800 dark:text-ink-100">
              {tp('lote.done.degraded_title', { n: result.batch.succeededDegraded })}
            </p>
            <p class="mt-1 text-xs text-ink-700 dark:text-ink-300">
              {t('lote.done.degraded_body')}
            </p>
          </div>
        {/if}

        {#if appFailedToLoad}
          <div class="rounded-xl border-l-4 border-err-500 bg-err-500/10 px-4 py-3" role="alert">
            <p class="text-sm text-ink-800 dark:text-ink-100">
              {t('lote.error.stale_app')}
            </p>
            <button
              type="button"
              onclick={() => location.reload()}
              class="mt-3 h-11 px-4 rounded-md bg-brand-500 hover:bg-brand-600 active:scale-[0.98] text-white text-sm font-medium transition-all duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              {t('lote.error.reload')}
            </button>
          </div>
        {/if}

        {#if result.excluded.length > 0}
          <div>
            <p class="text-sm font-medium text-ink-800 dark:text-ink-100 mb-2">
              {tp('lote.done.excluded_title', { n: result.excluded.length })}
            </p>
            <LoteList
              rows={result.excluded.map((ex) => ({
                id: ex.id,
                name: ex.originalName,
                statusLabel: exclusionLabel(ex.reason),
                detail: [reasonLabel(ex.detail), technicalDetail.get(ex.id)]
                  .filter((part) => part !== undefined && part !== '')
                  .join(' — '),
                tone: ex.reason === 'needs_review' ? ('warn' as const) : ('err' as const),
              }))}
            />
          </div>
        {/if}

        <p class="text-xs text-ink-600 dark:text-ink-400">
          {t('lote.done.zip_note')}
        </p>

        <div class="flex flex-wrap gap-3">
          <button
            type="button"
            onclick={restart}
            class="h-12 px-5 rounded-md border border-ink-300 dark:border-ink-700 bg-ink-50 dark:bg-ink-900 hover:bg-ink-100 dark:hover:bg-ink-800 text-ink-700 dark:text-ink-100 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {t('lote.done.restart')}
          </button>
          <button
            type="button"
            onclick={() => push('/firmar')}
            class="h-12 px-5 rounded-md text-ink-600 dark:text-ink-400 font-medium hover:text-ink-900 dark:hover:text-ink-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {t('firmar.title')}
          </button>
        </div>
      </div>
    {/if}
  {/snippet}
</WizardShell>

<style>
  .spin-slow {
    animation: spin 900ms linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spin-slow {
      animation-duration: 2.4s;
    }
  }
</style>
