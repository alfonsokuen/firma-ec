<script lang="ts">
  /**
   * WizardProgress.svelte — F3 stepper.
   *
   * Desktop: dots horizontales con conector. Mobile: barra lineal + texto
   * "Paso N de 7" (los 7 dots no caben con padding cómodo en 390px).
   *
   * El componente decide layout via CSS (sm: breakpoint). El JS solo expone
   * el estado actual y los labels para AT.
   */
  import { tp, type UIKey } from '../../lib/i18n.svelte.ts';

  interface Step {
    /** Stable id for keyed transitions. */
    id: string;
    /** i18n key for human label (used by AT, no UI render). */
    labelKey: UIKey;
  }

  interface Props {
    steps: Step[];
    /** 1-based index of the current step. */
    current: number;
  }

  const { steps, current }: Props = $props();

  const total = $derived(steps.length);
  // Clamp 1..total
  const idx = $derived(Math.max(1, Math.min(current, total)));
  const pct = $derived(total > 1 ? ((idx - 1) / (total - 1)) * 100 : 0);

  const ariaLabel = $derived(tp('firmar.aria.progress', { n: idx }));
  const stepOf = $derived(tp('firmar.step_of', { n: idx }));
</script>

<div
  role="progressbar"
  aria-label={ariaLabel}
  aria-valuenow={idx}
  aria-valuemin={1}
  aria-valuemax={total}
  class="w-full"
>
  <!-- Mobile: linear bar + text label -->
  <div class="sm:hidden flex flex-col gap-2">
    <p class="text-sm text-ink-500 dark:text-ink-400 font-mono">
      {stepOf}
    </p>
    <div class="relative h-1 w-full rounded-full bg-ink-200 dark:bg-ink-800 overflow-hidden">
      <div
        class="absolute inset-y-0 left-0 bg-brand-500 rounded-full"
        style="width: {pct}%; transition: width var(--motion-state-lg) var(--motion-curve);"
      ></div>
    </div>
  </div>

  <!-- Desktop: dots with connectors -->
  <ol class="hidden sm:flex items-center gap-0 w-full" aria-hidden="true">
    {#each steps as step, i (step.id)}
      {@const stepNum = i + 1}
      {@const isDone = stepNum < idx}
      {@const isCurrent = stepNum === idx}
      <li class="flex items-center {i < steps.length - 1 ? 'flex-1' : ''}">
        <span
          class="dot"
          class:dot-done={isDone}
          class:dot-current={isCurrent}
        ></span>
        {#if i < steps.length - 1}
          <span
            class="connector"
            class:connector-filled={isDone}
          ></span>
        {/if}
      </li>
    {/each}
  </ol>

  <!-- SR-only label list for AT (cuenta con labels reales) -->
  <ol class="sr-only">
    {#each steps as step, i (step.id)}
      <li aria-current={i + 1 === idx ? 'step' : undefined}>
        {tp(step.labelKey, {})}
      </li>
    {/each}
  </ol>
</div>

<style>
  .dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: var(--r-full);
    background: var(--ink-200);
    transition: background var(--motion-state) var(--motion-curve),
      transform var(--motion-state) var(--motion-curve);
    flex-shrink: 0;
  }
  :global([data-theme='dark']) .dot {
    background: var(--ink-800);
  }
  .dot-done {
    background: var(--brand-500);
  }
  .dot-current {
    background: var(--brand-500);
    transform: scale(1.4);
    box-shadow: var(--shadow-focus);
  }
  .connector {
    flex: 1;
    height: 2px;
    background: var(--ink-200);
    margin: 0 4px;
    transition: background var(--motion-state-lg) var(--motion-curve);
  }
  :global([data-theme='dark']) .connector {
    background: var(--ink-800);
  }
  .connector-filled {
    background: var(--brand-500);
  }
</style>
