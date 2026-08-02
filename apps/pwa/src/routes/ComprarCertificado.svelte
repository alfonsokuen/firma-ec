<script lang="ts">
import { onMount } from 'svelte';
/**
 * F9.0c — Compra de certificado, wizard "fácil hasta para un niño".
 * Un solo foco por pantalla, pasos mínimos, lenguaje llano, touch targets grandes.
 * Estética: tokens firmar.ec (ink/brand, Geist, lucide). Motion sutil con CSS/Svelte.
 *
 * Pasos: 1 Plan · 2 Identidad (cédula+dactilar) · 3 Datos · 4 Fotos · 5 Pagar.
 * No custodia llaves; sube docs cifrados (backend) y redirige a PayPhone.
 */
import { cubicOut } from 'svelte/easing';
import { fly } from 'svelte/transition';
import {
  type CertFileInput,
  type CertPlan,
  checkout,
  fetchPlanes,
  fileToB64,
} from '../lib/certsApi.ts';
import Button from '../ui/Button.svelte';

const reduce =
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const flyIn = { y: reduce ? 0 : 10, duration: reduce ? 0 : 220, easing: cubicOut };

const STEPS = ['Plan', 'Identidad', 'Tus datos', 'Fotos', 'Pagar'] as const;
let step = $state(0); // 0..4

let plans = $state<CertPlan[]>([]);
let loadingPlans = $state(true);
let selectedPlan = $state<number | null>(null);
let submitting = $state(false);
let error = $state<string | null>(null);

const f = $state({
  idNumber: '',
  fingerPrintId: '',
  names: '',
  surNames: '',
  country: 'EC',
  province: '',
  city: '',
  homeAddress: '',
  phoneExtension: '593',
  phoneNumber: '',
  requestorEmail: '',
  consent: false,
});
let citizenDoc = $state<File | null>(null);
let lifeTest = $state<File | null>(null);
let photo = $state<File | null>(null);

const CEDULA = /^[0-9]{10}$/;
const DACTILAR = /^[A-Z0-9]{6,10}$/;
const PHONE = /^[0-9]{10}$/;

const plan = $derived(plans.find((p) => p.id === selectedPlan) ?? null);

/** periodo en español, singular/plural. */
function periodoEs(periodo: string, n: number): string {
  const map: Record<string, [string, string]> = {
    DAYS: ['día', 'días'],
    MONTHS: ['mes', 'meses'],
    YEARS: ['año', 'años'],
  };
  const pair = map[periodo] ?? [periodo.toLowerCase(), periodo.toLowerCase()];
  return `${n} ${n === 1 ? pair[0] : pair[1]}`;
}

// Al cambiar de paso, volver arriba para que se vea el progreso y el título.
$effect(() => {
  void step;
  if (typeof window !== 'undefined') {
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  }
});

const stepValid = $derived.by(() => {
  switch (step) {
    case 0:
      return selectedPlan !== null;
    case 1:
      return CEDULA.test(f.idNumber) && DACTILAR.test(f.fingerPrintId.toUpperCase());
    case 2:
      return (
        f.names.trim() !== '' &&
        f.surNames.trim() !== '' &&
        f.province.trim() !== '' &&
        f.city.trim() !== '' &&
        f.homeAddress.trim() !== '' &&
        PHONE.test(f.phoneNumber) &&
        f.requestorEmail.includes('@')
      );
    case 3:
      return !!citizenDoc && !!lifeTest && !!photo;
    case 4:
      return f.consent;
    default:
      return false;
  }
});

onMount(async () => {
  try {
    plans = await fetchPlanes('natural');
  } catch (e) {
    error = e instanceof Error ? e.message : 'No se pudieron cargar los planes';
  } finally {
    loadingPlans = false;
  }
});

function next(): void {
  if (!stepValid) return;
  if (step < STEPS.length - 1) step += 1;
  else void pay();
}
function back(): void {
  if (step > 0) step -= 1;
}

function pickFile(e: Event, set: (file: File | null) => void): void {
  const input = e.currentTarget as HTMLInputElement;
  set(input.files?.[0] ?? null);
}

async function pay(): Promise<void> {
  if (selectedPlan === null) return;
  submitting = true;
  error = null;
  try {
    const files: CertFileInput[] = await Promise.all(
      (
        [
          ['citizenDoc', citizenDoc],
          ['lifeTest', lifeTest],
          ['photo', photo],
        ] as const
      ).map(async ([name, file]) => ({
        name,
        contentType: (file?.type === 'image/png' ? 'image/png' : 'image/jpeg') as
          | 'image/png'
          | 'image/jpeg',
        contentB64: await fileToB64(file as File),
        fileName: (file as File).name,
      })),
    );
    const res = await checkout({
      pricingPlanId: selectedPlan,
      email: f.requestorEmail,
      properties: {
        idType: 'citizen',
        idNumber: f.idNumber,
        fingerPrintId: f.fingerPrintId.toUpperCase(),
        names: f.names,
        surNames: f.surNames,
        country: f.country,
        province: f.province,
        city: f.city,
        homeAddress: f.homeAddress,
        phoneExtension: f.phoneExtension,
        phoneNumber: f.phoneNumber,
        requestorEmail: f.requestorEmail,
      },
      files,
      acceptedWill: true,
      acceptedContract: true,
    });
    window.location.href = res.urlPago;
  } catch (e) {
    error = e instanceof Error ? e.message : 'Algo salió mal. Inténtalo de nuevo.';
    submitting = false;
  }
}
</script>

{#snippet field(label: string, hint: string)}
  <span class="block text-sm font-medium text-ink-700 dark:text-ink-300">{label}</span>
  {#if hint}<span class="mt-0.5 block text-xs text-ink-400">{hint}</span>{/if}
{/snippet}

<section class="mx-auto flex min-h-[100dvh] max-w-md flex-col px-5 pb-28 pt-6">
  <!-- Progreso -->
  <header class="mb-8">
    <div class="flex items-center justify-between">
      <button
        onclick={back}
        disabled={step === 0}
        aria-label="Atrás"
        class="grid size-10 place-items-center rounded-full text-ink-500 transition-colors hover:bg-ink-100 disabled:opacity-0 dark:hover:bg-ink-800"
      >
        <span class="i-lucide-arrow-left size-5"></span>
      </button>
      <span class="text-xs font-medium tracking-wide text-ink-400">
        Paso {step + 1} de {STEPS.length}
      </span>
      <span class="size-10"></span>
    </div>
    <div class="mt-4 flex gap-1.5" aria-hidden="true">
      {#each STEPS as _s, i (i)}
        <span
          class="h-1.5 flex-1 rounded-full transition-colors duration-300"
          class:bg-brand-500={i <= step}
          class:bg-ink-200={i > step}
          class:dark:bg-ink-800={i > step}
        ></span>
      {/each}
    </div>
  </header>

  <!-- Contenido del paso -->
  <div class="flex-1">
    {#if error}
      <p class="mb-4 rounded-lg bg-err-500/10 px-4 py-3 text-sm text-err-500">{error}</p>
    {/if}

    {#key step}
      <div in:fly={flyIn}>
        {#if step === 0}
          <h1 class="font-display text-fluid-26-32 font-semibold tracking-tight text-ink-900 dark:text-ink-50">
            ¿Por cuánto tiempo lo quieres?
          </h1>
          <p class="mt-2 text-ink-500">Elige una opción. Puedes cambiarla después.</p>

          {#if loadingPlans}
            <div class="mt-6 space-y-3">
              {#each [1, 2, 3] as n (n)}
                <div class="h-16 animate-pulse rounded-xl bg-ink-100 dark:bg-ink-800"></div>
              {/each}
            </div>
          {:else}
            <div class="mt-6 space-y-3">
              {#each plans as p (p.id)}
                <button
                  onclick={() => (selectedPlan = p.id)}
                  class="flex w-full items-center justify-between rounded-xl border bg-white px-5 py-4 text-left transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] active:scale-[0.99] dark:bg-ink-900"
                  class:border-brand-500={selectedPlan === p.id}
                  class:ring-2={selectedPlan === p.id}
                  class:ring-brand-500={selectedPlan === p.id}
                  class:border-ink-200={selectedPlan !== p.id}
                  class:dark:border-ink-700={selectedPlan !== p.id}
                >
                  <span>
                    <span class="block font-semibold text-ink-900 dark:text-ink-50">{p.titulo}</span>
                    <span class="text-sm text-ink-400">{periodoEs(p.periodo, p.duracion)}</span>
                  </span>
                  <span class="flex items-center gap-3">
                    <span class="font-display text-lg font-semibold text-ink-900 dark:text-ink-50">
                      ${p.pvp}
                    </span>
                    <span
                      class="grid size-6 place-items-center rounded-full transition-colors"
                      class:bg-brand-500={selectedPlan === p.id}
                      class:text-white={selectedPlan === p.id}
                      class:bg-ink-100={selectedPlan !== p.id}
                      class:dark:bg-ink-800={selectedPlan !== p.id}
                    >
                      {#if selectedPlan === p.id}<span class="i-lucide-check size-4"></span>{/if}
                    </span>
                  </span>
                </button>
              {/each}
            </div>
          {/if}
        {:else if step === 1}
          <h1 class="font-display text-fluid-26-32 font-semibold tracking-tight text-ink-900 dark:text-ink-50">
            ¿Quién eres?
          </h1>
          <p class="mt-2 text-ink-500">Escribe tu número de cédula tal como aparece.</p>

          <label class="mt-6 block">
            {@render field('Número de cédula', '10 números, sin guiones')}
            <input
              bind:value={f.idNumber}
              inputmode="numeric"
              maxlength="10"
              placeholder="0102030405"
              class="mt-2 w-full min-h-13 rounded-xl border border-ink-300 bg-white px-4 text-lg tracking-wide text-ink-900 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-50"
            />
          </label>

          <label class="mt-5 block">
            {@render field('Código dactilar', 'Está al reverso de tu cédula (ej. V1234567)')}
            <input
              bind:value={f.fingerPrintId}
              autocapitalize="characters"
              maxlength="10"
              placeholder="V1234567"
              class="mt-2 w-full min-h-13 rounded-xl border border-ink-300 bg-white px-4 text-lg uppercase tracking-wide text-ink-900 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-50"
            />
          </label>
        {:else if step === 2}
          <h1 class="font-display text-fluid-26-32 font-semibold tracking-tight text-ink-900 dark:text-ink-50">
            Tus datos
          </h1>
          <p class="mt-2 text-ink-500">Los usamos para emitir tu certificado.</p>

          <div class="mt-6 space-y-4">
            <label class="block">
              {@render field('Nombres', '')}
              <input bind:value={f.names} class="ce-input" placeholder="Juan Carlos" />
            </label>
            <label class="block">
              {@render field('Apellidos', '')}
              <input bind:value={f.surNames} class="ce-input" placeholder="Pérez López" />
            </label>
            <div class="grid grid-cols-2 gap-3">
              <label class="block">
                {@render field('Provincia', '')}
                <input bind:value={f.province} class="ce-input" placeholder="Guayas" />
              </label>
              <label class="block">
                {@render field('Ciudad', '')}
                <input bind:value={f.city} class="ce-input" placeholder="Guayaquil" />
              </label>
            </div>
            <label class="block">
              {@render field('Dirección', '')}
              <input bind:value={f.homeAddress} class="ce-input" placeholder="Av. Principal y calle 2" />
            </label>
            <label class="block">
              {@render field('Teléfono', '10 números')}
              <input
                bind:value={f.phoneNumber}
                inputmode="numeric"
                maxlength="10"
                class="ce-input"
                placeholder="0991234567"
              />
            </label>
            <label class="block">
              {@render field('Correo', 'Ahí te llega tu certificado')}
              <input bind:value={f.requestorEmail} type="email" class="ce-input" placeholder="tucorreo@gmail.com" />
            </label>
          </div>
        {:else if step === 3}
          <h1 class="font-display text-fluid-26-32 font-semibold tracking-tight text-ink-900 dark:text-ink-50">
            Tres fotos
          </h1>
          <p class="mt-2 text-ink-500">Tómalas con tu cámara. Que se vean claras.</p>

          <div class="mt-6 space-y-3">
            {@render photoTile('citizenDoc', 'Foto de tu cédula', 'i-lucide-credit-card', citizenDoc, (x) => (citizenDoc = x), 'environment')}
            {@render photoTile('lifeTest', 'Una selfie tuya ahora', 'i-lucide-smile', lifeTest, (x) => (lifeTest = x), 'user')}
            {@render photoTile('photo', 'Una foto tuya', 'i-lucide-user', photo, (x) => (photo = x), 'user')}
          </div>
        {:else if step === 4}
          <h1 class="font-display text-fluid-26-32 font-semibold tracking-tight text-ink-900 dark:text-ink-50">
            Todo listo
          </h1>
          <p class="mt-2 text-ink-500">Revisa y paga para emitir tu certificado.</p>

          <div class="mt-6 divide-y divide-ink-200 rounded-xl border border-ink-200 dark:divide-ink-800 dark:border-ink-700">
            <div class="flex items-center justify-between px-5 py-4">
              <span class="text-ink-500">Plan</span>
              <span class="font-medium text-ink-900 dark:text-ink-50">{plan?.titulo ?? '—'}</span>
            </div>
            <div class="flex items-center justify-between px-5 py-4">
              <span class="text-ink-500">Cédula</span>
              <span class="font-medium text-ink-900 dark:text-ink-50">{f.idNumber}</span>
            </div>
            <div class="flex items-center justify-between px-5 py-4">
              <span class="text-ink-500">Total a pagar</span>
              <span class="font-display text-xl font-semibold text-ink-900 dark:text-ink-50">${plan?.pvp ?? '—'}</span>
            </div>
          </div>

          <label class="mt-6 flex cursor-pointer items-start gap-3">
            <input type="checkbox" bind:checked={f.consent} class="mt-1 size-5 accent-brand-500" />
            <span class="text-sm text-ink-600 dark:text-ink-300">
              Autorizo usar mis datos y fotos solo para emitir mi certificado, y acepto los términos del servicio.
            </span>
          </label>
        {/if}
      </div>
    {/key}
  </div>
</section>

<!-- CTA fija inferior -->
<div class="fixed inset-x-0 bottom-0 border-t border-ink-200 bg-ink-50/90 px-5 py-4 backdrop-blur dark:border-ink-800 dark:bg-ink-950/90">
  <div class="mx-auto max-w-md">
    <Button variant="primary" size="lg" class="w-full justify-center" disabled={!stepValid || submitting} onclick={next}>
      {#if submitting}
        Procesando…
      {:else if step === STEPS.length - 1}
        Pagar ${plan?.pvp ?? ''}
      {:else}
        Siguiente
      {/if}
    </Button>
  </div>
</div>

{#snippet photoTile(
  id: string,
  label: string,
  icon: string,
  file: File | null,
  set: (f: File | null) => void,
  capture: 'user' | 'environment',
)}
  <label
    class="flex cursor-pointer items-center gap-4 rounded-xl border-2 border-dashed px-5 py-4 transition-colors"
    class:border-ok-500={!!file}
    class:border-ink-300={!file}
    class:dark:border-ink-700={!file}
  >
    <span
      class="grid size-11 shrink-0 place-items-center rounded-full"
      class:bg-ok-500={!!file}
      class:text-white={!!file}
      class:bg-ink-100={!file}
      class:text-ink-500={!file}
      class:dark:bg-ink-800={!file}
    >
      <span class="{file ? 'i-lucide-check' : icon} size-5"></span>
    </span>
    <span class="min-w-0 flex-1">
      <span class="block font-medium text-ink-900 dark:text-ink-50">{label}</span>
      <span class="block truncate text-sm text-ink-400">
        {file ? 'Foto lista — toca para cambiar' : 'Toca para tomar la foto'}
      </span>
    </span>
    <input
      type="file"
      accept="image/*"
      {capture}
      onchange={(e) => pickFile(e, set)}
      class="sr-only"
      aria-label={label}
    />
  </label>
{/snippet}

<style>
  /* Input compartido del paso "Tus datos" (touch target ≥48px, foco brand). */
  :global(.ce-input) {
    margin-top: 0.5rem;
    width: 100%;
    min-height: 3rem;
    border-radius: 0.75rem;
    border: 1px solid var(--colors-ink-300, oklch(82% 0.03 250));
    background: #fff;
    padding: 0 1rem;
    font-size: 1rem;
    color: oklch(14% 0.04 250);
    outline: none;
    transition: border-color 150ms ease, box-shadow 150ms ease;
  }
  :global(.ce-input:focus) {
    border-color: oklch(58% 0.21 245);
    box-shadow: 0 0 0 3px color-mix(in oklch, oklch(58% 0.21 245) 20%, transparent);
  }
  :global([data-theme='dark'] .ce-input) {
    background: oklch(14% 0.04 250);
    border-color: oklch(32% 0.06 250);
    color: oklch(98% 0.005 250);
  }
</style>
