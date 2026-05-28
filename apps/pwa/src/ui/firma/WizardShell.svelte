<script lang="ts">
import type { Snippet } from 'svelte';
/**
 * WizardShell.svelte — layout container del wizard de firma F3.
 *
 * Mobile: full-width, sticky bottom action-bar. Desktop: max-w-2xl centered.
 * Slots: header (WizardProgress), body (current step), footer (Back/Next CTAs).
 * Slide-x animation entre steps con `cubic-bezier(0.32,0.72,0,1)` 250ms; el
 * cambio de `currentStep` dispara la animación via key block en el body.
 *
 * Back deshabilitado en step 1; Next deshabilitado hasta `canNext`.
 * El paso 4 (PinInput) tiene su propio CTA "Verificar contraseña": la route
 * pasa `hideNext` para suprimir el botón Next del footer (evita un botón
 * duplicado) pero conserva "Atrás" + el indicador de paso. `hideFooter` oculta
 * el footer entero (pasos 1/3/6 que gestionan su propia navegación).
 */
import { getLang, t, tp } from '../../lib/i18n.svelte.ts';

interface Props {
  /** 1-based current step. */
  currentStep: number;
  totalSteps: number;
  /** Header content — typically <WizardProgress />. */
  header?: Snippet;
  /** Body content — the active step component. */
  body: Snippet;
  /** Optional footer override. If absent, default Back/Next bar is rendered. */
  footer?: Snippet;
  canBack?: boolean;
  canNext?: boolean;
  /** Hide the default Back/Next footer (cuando el step tiene CTA propio). */
  hideFooter?: boolean;
  /** Hide only the Next button (step con CTA propio que aún necesita "Atrás"). */
  hideNext?: boolean;
  /** Custom label for the Next button (e.g. "Firmar PDF"). */
  nextLabel?: string | undefined;
  onBack?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
}

let {
  currentStep,
  totalSteps,
  header,
  body,
  footer,
  canBack = true,
  canNext = false,
  hideFooter = false,
  hideNext = false,
  nextLabel,
  onBack,
  onNext,
}: Props = $props();

const lang = $derived(getLang());
// Reactive marker so $derived doesn't get DCE'd if lang isn't read elsewhere.
$effect(() => {
  void lang;
});

// Slide direction: forward when step increases, backward when decreases.
let prevStep = $state(0);
let direction = $state<'forward' | 'back'>('forward');
$effect(() => {
  const s = currentStep;
  if (prevStep === 0) {
    prevStep = s;
    return;
  }
  if (s > prevStep) direction = 'forward';
  else if (s < prevStep) direction = 'back';
  prevStep = s;
});
</script>

<section
  class="wizard-shell w-full mx-auto px-4 py-6 sm:py-10 sm:max-w-2xl"
  aria-label={t('firmar.title')}
>
  {#if header}
    <header class="mb-6 sm:mb-8">
      {@render header()}
    </header>
  {/if}

  <div class="wizard-body relative" aria-live="polite">
    {#key currentStep}
      <div
        class="wizard-step"
        class:slide-forward={direction === 'forward'}
        class:slide-back={direction === 'back'}
      >
        {@render body()}
      </div>
    {/key}
  </div>

  {#if footer}
    {@render footer()}
  {:else if !hideFooter}
    <footer
      class="
        mt-8 flex items-center justify-between gap-3
        sm:static sm:border-0 sm:bg-transparent sm:p-0
      "
    >
      <button
        type="button"
        onclick={onBack}
        disabled={!canBack || currentStep <= 1}
        aria-label={t('firmar.back')}
        class="
          inline-flex items-center justify-center gap-2
          h-12 px-5 rounded-md
          border border-ink-300 dark:border-ink-700
          bg-ink-50 dark:bg-ink-900
          hover:bg-ink-100 dark:hover:bg-ink-800
          text-ink-700 dark:text-ink-100 font-medium
          transition-colors
          disabled:opacity-40 disabled:cursor-not-allowed
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950
        "
      >
        <span class="i-lucide-chevron-left text-base" aria-hidden="true"></span>
        <span>{t('firmar.back')}</span>
      </button>

      <p class="text-xs text-ink-500 dark:text-ink-400 font-mono select-none">
        {tp('firmar.step_of', { n: currentStep })}
      </p>

      {#if !hideNext}
        <button
          type="button"
          onclick={onNext}
          disabled={!canNext}
          aria-label={nextLabel ?? t('firmar.next')}
          class="
            inline-flex items-center justify-center gap-2
            h-12 px-6 rounded-md
            bg-brand-500 hover:bg-brand-600 active:scale-[0.98]
            text-white font-medium
            transition-all duration-100
            disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-brand-500 disabled:active:scale-100
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2
          "
          style="box-shadow: var(--shadow-rest);"
        >
          <span>{nextLabel ?? t('firmar.next')}</span>
          <span class="i-lucide-chevron-right text-base" aria-hidden="true"></span>
        </button>
      {/if}
    </footer>
  {/if}
</section>

<style>
  .wizard-shell {
    container-type: inline-size;
  }
  .wizard-body {
    min-height: 240px;
    overflow: hidden;
  }
  .wizard-step {
    will-change: transform, opacity;
  }
  .slide-forward {
    animation: slide-in-right 250ms cubic-bezier(0.32, 0.72, 0, 1);
  }
  .slide-back {
    animation: slide-in-left 250ms cubic-bezier(0.32, 0.72, 0, 1);
  }
  @keyframes slide-in-right {
    0% { transform: translateX(24px); opacity: 0; }
    100% { transform: translateX(0); opacity: 1; }
  }
  @keyframes slide-in-left {
    0% { transform: translateX(-24px); opacity: 0; }
    100% { transform: translateX(0); opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .slide-forward,
    .slide-back {
      animation: fade-only 160ms linear;
    }
    @keyframes fade-only {
      0% { opacity: 0; }
      100% { opacity: 1; }
    }
  }
</style>
