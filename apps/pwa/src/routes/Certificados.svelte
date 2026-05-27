<script lang="ts">
/**
 * F9 — Entrada a la compra de certificado. Propuesta clara + planes + CTA.
 * Estética tokens firmar.ec (ink/brand, Geist). El flujo guiado vive en /comprar.
 */
import { onMount } from 'svelte';
import { type CertPlan, fetchPlanes } from '../lib/certsApi.ts';
import Button from '../ui/Button.svelte';

let plans = $state<CertPlan[]>([]);
let loading = $state(true);
let error = $state<string | null>(null);

const desde = $derived(
  plans.length ? plans.map((p) => Number(p.pvp)).sort((a, b) => a - b)[0]?.toFixed(2) : null,
);

onMount(async () => {
  try {
    plans = await fetchPlanes('natural');
  } catch (e) {
    error = e instanceof Error ? e.message : null;
  } finally {
    loading = false;
  }
});
</script>

<section class="mx-auto max-w-md px-5 py-10">
  <h1 class="font-display text-fluid-30-40 font-semibold leading-tight tracking-tight text-ink-900 dark:text-ink-50">
    Tu certificado de<br />firma electrónica
  </h1>
  <p class="mt-3 text-lg text-ink-500">
    Emitido por una entidad acreditada. Lo sacas en minutos, desde el teléfono.
  </p>

  <!-- 3 razones, sin tarjetas: ritmo por espacio -->
  <ul class="mt-8 space-y-4">
    <li class="flex items-start gap-3">
      <span class="i-lucide-smartphone mt-0.5 size-5 shrink-0 text-brand-500"></span>
      <span class="text-ink-700 dark:text-ink-300">Solo necesitas tu cédula y el teléfono.</span>
    </li>
    <li class="flex items-start gap-3">
      <span class="i-lucide-clock mt-0.5 size-5 shrink-0 text-brand-500"></span>
      <span class="text-ink-700 dark:text-ink-300">5 pasos guiados. Sin trámites ni filas.</span>
    </li>
    <li class="flex items-start gap-3">
      <span class="i-lucide-shield-check mt-0.5 size-5 shrink-0 text-brand-500"></span>
      <span class="text-ink-700 dark:text-ink-300">Tus datos solo se usan para emitir tu certificado.</span>
    </li>
  </ul>

  {#if loading}
    <div class="mt-10 h-6 w-40 animate-pulse rounded bg-ink-100 dark:bg-ink-800"></div>
  {:else if error}
    <p class="mt-10 text-sm text-ink-400">No pudimos cargar los precios ahora.</p>
  {:else if desde}
    <p class="mt-10 text-ink-500">
      Desde <span class="font-display text-2xl font-semibold text-ink-900 dark:text-ink-50">${desde}</span>
    </p>
  {/if}

  <div class="mt-6">
    <Button href="/certificados/comprar" variant="primary" size="lg" class="w-full justify-center">
      Empezar
      <span class="i-lucide-arrow-right size-5"></span>
    </Button>
  </div>
</section>
