<script lang="ts">
/**
 * UsageCounter — live, honest social proof for the firmar.ec landing.
 *
 * Reads real totals from the edge Worker (GET /api/stats, same origin) and
 * counts up to them. Everything degrades quietly: while loading it reserves
 * space with a
 * skeleton; on fetch error or an all-zero response it renders nothing (no
 * embarrassing "0 documentos"); a stat that is null/0 is dropped individually.
 * `prefers-reduced-motion` skips the count-up. No cards, no accent stripes —
 * just numerals with quiet labels.
 */
import { onMount } from 'svelte';

interface Labels {
  signed: string;
  verified: string;
  validated: string;
  certs: string;
}
interface Props {
  lang?: 'es' | 'en';
  labels: Labels;
  /** Dev/test override; same-origin (/api/stats via the edge Worker) otherwise. */
  apiBase?: string;
  /** Wrapper spacing utility (e.g. 'mt-10' at the bottom of the hero, 'mb-8' when placed on top). */
  spacing?: string;
  /** Cap how many stats show below md (keeps the hero row on a single line on phones).
   *  0 = no cap (show all at every width). */
  mobileMax?: number;
}
let { lang = 'es', labels, apiBase, spacing = 'mt-10', mobileMax = 0 }: Props = $props();

interface Stat {
  key: 'signed' | 'verified' | 'validated' | 'certs';
  target: number;
  label: string;
}

let phase = $state<'loading' | 'ready' | 'hidden'>('loading');
let stats = $state<Stat[]>([]);
let display = $state<number[]>([]);

const nf = new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'es-EC');

function resolveBase(): string {
  if (apiBase && apiBase.length > 0) return apiBase.replace(/\/+$/, '');
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const override = env?.['PUBLIC_STATS_API_BASE'];
  if (override && override.length > 0) return override.replace(/\/+$/, '');
  // Same-origin: the edge Worker serves /api/stats on firmar.ec itself.
  return '';
}

interface StatsResponse {
  pdfsSigned?: number;
  signaturesVerified?: number;
  certificatesValidated?: number | null;
  certificatesIssued?: number | null;
}

function countUp(targets: number[], reduced: boolean): void {
  if (reduced) {
    display = targets.slice();
    return;
  }
  display = targets.map(() => 0);
  const duration = 1100;
  const start = performance.now();
  const tick = (now: number): void => {
    const p = Math.min(1, (now - start) / duration);
    // ease-out-quart — fast then settles, no bounce.
    const e = 1 - (1 - p) ** 4;
    display = targets.map((t) => Math.round(t * e));
    if (p < 1) requestAnimationFrame(tick);
    else display = targets.slice();
  };
  requestAnimationFrame(tick);
}

onMount(async () => {
  let data: StatsResponse;
  try {
    const res = await fetch(`${resolveBase()}/api/stats`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json()) as StatsResponse;
  } catch {
    phase = 'hidden';
    return;
  }

  // Always show signed + verified (even at 0 — the real running total). Certs
  // only when the subsystem reports a real positive count (it's null today).
  const visible: Stat[] = [
    { key: 'signed', target: data.pdfsSigned ?? 0, label: labels.signed },
    { key: 'verified', target: data.signaturesVerified ?? 0, label: labels.verified },
  ];
  // Certificados validados: show only once the Validar-certificado feature has
  // real usage (>0), so the counter is never an embarrassing zero.
  const validated = data.certificatesValidated;
  if (typeof validated === 'number' && validated > 0) {
    visible.push({ key: 'validated', target: validated, label: labels.validated });
  }
  const certs = data.certificatesIssued;
  if (typeof certs === 'number' && certs > 0) {
    visible.push({ key: 'certs', target: certs, label: labels.certs });
  }
  stats = visible;
  phase = 'ready';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  countUp(
    visible.map((s) => s.target),
    reduced,
  );
});
</script>

{#if phase === 'loading'}
  <div class="{spacing} flex flex-wrap gap-x-8 gap-y-4 sm:gap-8" aria-hidden="true">
    {#each [0, 1, 2] as i (i)}
      <div class="flex flex-col gap-2 {mobileMax > 0 && i >= mobileMax ? 'lt-md:hidden' : ''}">
        <div class="h-7 w-16 animate-pulse rounded bg-ink-200/70 dark:bg-ink-800"></div>
        <div class="h-3 w-20 animate-pulse rounded bg-ink-200/50 dark:bg-ink-800/70"></div>
      </div>
    {/each}
  </div>
{:else if phase === 'ready'}
  <dl class="{spacing} flex flex-wrap gap-x-5 sm:gap-x-10 gap-y-4 sm:gap-y-6">
    {#each stats as s, i (s.key)}
      <!-- DOM order term→description (a11y); flex-col-reverse keeps the value
           visually on top. -->
      <div class="flex flex-col-reverse gap-2 min-w-0 {mobileMax > 0 && i >= mobileMax ? 'lt-md:hidden' : ''}">
        <dt class="text-[0.6875rem] sm:text-xs font-medium uppercase tracking-wide sm:tracking-wider text-ink-500">
          {s.label}
        </dt>
        <dd
          class="font-display text-2xl sm:text-3xl font-semibold leading-none tracking-tight tabular-nums text-ink-900 dark:text-ink-50"
        >
          {nf.format(display[i] ?? 0)}{#if s.target > 0}<span class="text-brand-500">+</span>{/if}
        </dd>
      </div>
    {/each}
  </dl>
{/if}
