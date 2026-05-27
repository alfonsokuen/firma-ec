<script lang="ts">
/**
 * F9.0c — Onboarding + checkout. Selección de plan + datos del solicitante +
 * documentos (cédula, prueba de vida, foto) → POST /checkout → redirige a PayPhone.
 * Validación cliente con los regex reales del API. No custodia llaves.
 */
import { onMount } from 'svelte';
import {
  type CertFileInput,
  type CertPlan,
  checkout,
  fetchPlanes,
  fileToB64,
} from '../lib/certsApi.ts';

let plans = $state<CertPlan[]>([]);
let selectedPlan = $state<number | null>(null);
let submitting = $state(false);
let error = $state<string | null>(null);

const form = $state({
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
  acceptedWill: false,
  acceptedContract: false,
});

let citizenDoc = $state<File | null>(null);
let lifeTest = $state<File | null>(null);
let photo = $state<File | null>(null);

const CEDULA = /^[0-9]{10}$/;
const DACTILAR = /^[A-Z0-9]{6,10}$/;
const PHONE = /^[0-9]{10}$/;

const valid = $derived(
  selectedPlan !== null &&
    CEDULA.test(form.idNumber) &&
    DACTILAR.test(form.fingerPrintId.toUpperCase()) &&
    form.names.trim().length > 0 &&
    form.surNames.trim().length > 0 &&
    form.homeAddress.trim().length > 0 &&
    PHONE.test(form.phoneNumber) &&
    form.requestorEmail.includes('@') &&
    !!citizenDoc &&
    !!lifeTest &&
    !!photo &&
    form.acceptedWill &&
    form.acceptedContract,
);

onMount(async () => {
  try {
    plans = await fetchPlanes('natural');
  } catch (e) {
    error = e instanceof Error ? e.message : 'error';
  }
});

async function submit(): Promise<void> {
  if (!valid || selectedPlan === null) return;
  submitting = true;
  error = null;
  try {
    const files: CertFileInput[] = await Promise.all(
      ([
        ['citizenDoc', citizenDoc],
        ['lifeTest', lifeTest],
        ['photo', photo],
      ] as const).map(async ([name, file]) => ({
        name,
        contentType: (file!.type === 'image/png' ? 'image/png' : 'image/jpeg') as
          | 'image/png'
          | 'image/jpeg',
        contentB64: await fileToB64(file!),
        fileName: file!.name,
      })),
    );
    const res = await checkout({
      pricingPlanId: selectedPlan,
      email: form.requestorEmail,
      properties: {
        idType: 'citizen',
        idNumber: form.idNumber,
        fingerPrintId: form.fingerPrintId.toUpperCase(),
        names: form.names,
        surNames: form.surNames,
        country: form.country,
        province: form.province,
        city: form.city,
        homeAddress: form.homeAddress,
        phoneExtension: form.phoneExtension,
        phoneNumber: form.phoneNumber,
        requestorEmail: form.requestorEmail,
      },
      files,
      acceptedWill: true,
      acceptedContract: true,
    });
    // Redirige a PayPhone para completar el pago.
    window.location.href = res.urlPago;
  } catch (e) {
    error = e instanceof Error ? e.message : 'error';
    submitting = false;
  }
}
</script>

<section class="mx-auto max-w-2xl px-4 py-8">
  <p class="mb-2 inline-block rounded bg-amber-100 px-2 py-1 text-xs text-amber-800">
    Vista previa (F9) — no operativo hasta integrar el pago real.
  </p>
  <h1 class="text-2xl font-semibold">Solicitar certificado</h1>

  {#if error}
    <p class="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
  {/if}

  <fieldset class="mt-6">
    <legend class="font-medium">1. Plan</legend>
    <div class="mt-2 grid gap-2 sm:grid-cols-2">
      {#each plans as plan (plan.id)}
        <label class="flex cursor-pointer items-center gap-2 rounded border p-3"
          class:border-slate-900={selectedPlan === plan.id}>
          <input type="radio" name="plan" value={plan.id} bind:group={selectedPlan} />
          <span>{plan.titulo} — <strong>${plan.pvp}</strong></span>
        </label>
      {/each}
    </div>
  </fieldset>

  <fieldset class="mt-6 grid gap-3 sm:grid-cols-2">
    <legend class="font-medium">2. Datos del solicitante</legend>
    <label class="text-sm">Cédula
      <input class="mt-1 w-full rounded border p-2" bind:value={form.idNumber} maxlength="10" />
    </label>
    <label class="text-sm">Código dactilar
      <input class="mt-1 w-full rounded border p-2" bind:value={form.fingerPrintId} />
    </label>
    <label class="text-sm">Nombres
      <input class="mt-1 w-full rounded border p-2" bind:value={form.names} />
    </label>
    <label class="text-sm">Apellidos
      <input class="mt-1 w-full rounded border p-2" bind:value={form.surNames} />
    </label>
    <label class="text-sm">Provincia
      <input class="mt-1 w-full rounded border p-2" bind:value={form.province} />
    </label>
    <label class="text-sm">Ciudad
      <input class="mt-1 w-full rounded border p-2" bind:value={form.city} />
    </label>
    <label class="text-sm sm:col-span-2">Dirección
      <input class="mt-1 w-full rounded border p-2" bind:value={form.homeAddress} />
    </label>
    <label class="text-sm">Teléfono
      <input class="mt-1 w-full rounded border p-2" bind:value={form.phoneNumber} maxlength="10" />
    </label>
    <label class="text-sm">Correo
      <input class="mt-1 w-full rounded border p-2" type="email" bind:value={form.requestorEmail} />
    </label>
  </fieldset>

  <fieldset class="mt-6 grid gap-3">
    <legend class="font-medium">3. Documentos (foto jpg/png)</legend>
    <label class="text-sm">Cédula (imagen)
      <input class="mt-1 block" type="file" accept="image/*"
        onchange={(e) => (citizenDoc = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} />
    </label>
    <label class="text-sm">Prueba de vida (selfie)
      <input class="mt-1 block" type="file" accept="image/*"
        onchange={(e) => (lifeTest = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} />
    </label>
    <label class="text-sm">Foto
      <input class="mt-1 block" type="file" accept="image/*"
        onchange={(e) => (photo = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} />
    </label>
  </fieldset>

  <fieldset class="mt-6 grid gap-2">
    <label class="flex items-center gap-2 text-sm">
      <input type="checkbox" bind:checked={form.acceptedWill} /> Acepto el tratamiento de mis datos.
    </label>
    <label class="flex items-center gap-2 text-sm">
      <input type="checkbox" bind:checked={form.acceptedContract} /> Acepto el contrato del certificado.
    </label>
  </fieldset>

  <button
    class="mt-6 rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-40"
    disabled={!valid || submitting}
    onclick={submit}
  >
    {submitting ? 'Procesando…' : 'Pagar y solicitar'}
  </button>
</section>
