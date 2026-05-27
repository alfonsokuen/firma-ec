<script lang="ts">
/**
 * F9.0b — Certificados (preview). Lista los planes desde el backend (módulo
 * certs, hoy contra FakeSignareClient). El checkout + onboarding (subir cédula,
 * prueba de vida, CSR en cliente) llega en F9.0c. No maneja datos sensibles aún.
 */
import { onMount } from 'svelte';
import { type CertPlan, fetchPlanes } from '../lib/certsApi.ts';

let plans = $state<CertPlan[]>([]);
let loading = $state(true);
let error = $state<string | null>(null);

onMount(async () => {
  try {
    plans = await fetchPlanes('natural');
  } catch (e) {
    error = e instanceof Error ? e.message : 'error';
  } finally {
    loading = false;
  }
});
</script>

<section class="mx-auto max-w-3xl px-4 py-8">
  <p class="mb-2 inline-block rounded bg-amber-100 px-2 py-1 text-xs text-amber-800">
    Vista previa (F9) — emisión vía ArgosData/Signare. Aún no operativa.
  </p>
  <h1 class="text-2xl font-semibold">Comprar certificado de firma electrónica</h1>
  <p class="mt-2 text-sm text-slate-600">
    Certificado <code>.p12</code> emitido por una ACE acreditada. Tu llave puede generarse en
    este dispositivo (modo CSR) — firmar.ec actúa como canal, no custodia tu certificado.
  </p>

  {#if loading}
    <p class="mt-6 text-slate-500">Cargando planes…</p>
  {:else if error}
    <p class="mt-6 text-red-600">No se pudieron cargar los planes ({error}).</p>
  {:else}
    <ul class="mt-6 grid gap-3 sm:grid-cols-2">
      {#each plans as plan (plan.id)}
        <li class="rounded-lg border border-slate-200 p-4">
          <h2 class="font-medium">{plan.titulo}</h2>
          <p class="text-sm text-slate-500">{plan.duracion} {plan.periodo.toLowerCase()}</p>
          <p class="mt-2 text-xl font-semibold">${plan.pvp}<span class="text-sm font-normal text-slate-400"> {plan.moneda}</span></p>
        </li>
      {/each}
    </ul>
  {/if}
</section>
