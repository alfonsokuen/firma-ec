<script lang="ts">
/**
 * StatsDashboard — public, honest usage trend for firmar.ec.
 *
 * Extends the home `UsageCounter` (running totals) with a time dimension: the
 * edge Worker (GET /api/stats/series, same origin) returns pre-aggregated
 * buckets per day/week/month/year. Pure volume, no identifiers — same
 * zero-knowledge / LOPDP posture as the rest of the site.
 *
 * Design notes:
 * - Stacked bars (signed + verified) read cleanly even at 30 daily points and
 *   show both the total height and its composition. brand-500 is the single
 *   accent; the second series is neutral ink so the chart stays monochrome.
 * - A readout above the chart updates on hover/focus instead of floating
 *   tooltips. Every bar is a real <button> (keyboard + SR + touch), and a
 *   visually-hidden table mirrors the data as a robust fallback.
 * - Degrades honestly: skeleton while loading, an explicit empty state (the
 *   series only starts the day buckets were first written — see `since`), and
 *   an inline error with retry. `prefers-reduced-motion` skips the bar grow-in.
 */
import { onMount } from 'svelte';

type Granularity = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

interface Labels {
  signed: string;
  verified: string;
  certs: string;
  granularity: string; // aria-label for the period selector
  minute: string;
  hour: string;
  day: string;
  week: string;
  month: string;
  year: string;
  totalSigned: string;
  totalVerified: string;
  totalCerts: string;
  readoutHint: string;
  sincePrefix: string;
  emptyTitle: string;
  emptyBody: string;
  errorTitle: string;
  errorBody: string;
  retry: string;
  tableCaption: string;
  colPeriod: string;
}

interface Props {
  lang?: 'es' | 'en';
  labels: Labels;
  /** Dev/test override; same-origin (/api/stats via the edge Worker) otherwise. */
  apiBase?: string;
}
let { lang = 'es', labels, apiBase }: Props = $props();

interface Bucket {
  period: string;
  sign: number;
  verify: number;
  cert: number;
}
interface SeriesResponse {
  granularity: Granularity;
  since: string | null;
  buckets: Bucket[];
  totals: { sign: number; verify: number; cert: number };
}

const GRANULARITIES: Granularity[] = ['minute', 'hour', 'day', 'week', 'month', 'year'];

const totalStats: { key: 'sign' | 'verify' | 'cert'; label: string }[] = [
  { key: 'sign', label: labels.totalSigned },
  { key: 'verify', label: labels.totalVerified },
  { key: 'cert', label: labels.totalCerts },
];

const locale = lang === 'en' ? 'en-US' : 'es-EC';
const nf = new Intl.NumberFormat(locale);

let granularity = $state<Granularity>('day');
let phase = $state<'loading' | 'ready' | 'empty' | 'error'>('loading');
let data = $state<SeriesResponse | null>(null);
// Totals are granularity-independent and kept separately so a failed (or
// in-flight) series reload never erases known-good headline numbers, and a true
// load failure shows a neutral "—" instead of a fabricated "0".
let totals = $state<{ sign: number; verify: number; cert: number } | null>(null);
let activeIndex = $state<number | null>(null);
let reducedMotion = false;

function resolveBase(): string {
  if (apiBase && apiBase.length > 0) return apiBase.replace(/\/+$/, '');
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const override = env?.['PUBLIC_STATS_API_BASE'];
  if (override && override.length > 0) return override.replace(/\/+$/, '');
  return ''; // same origin — the Worker serves /api/stats* here too
}

/** Format a bucket period key for axis/readout/table, localized. */
function formatPeriod(period: string, g: Granularity, long = false): string {
  if (g === 'minute') {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'UTC',
    }).format(new Date(`${period}:00Z`));
  }
  if (g === 'hour') {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      ...(long ? { day: '2-digit', month: 'short' } : {}),
      timeZone: 'UTC',
    }).format(new Date(`${period}:00:00Z`));
  }
  if (g === 'year') return period;
  if (g === 'month') {
    const d = new Date(`${period}-01T12:00:00Z`);
    return new Intl.DateTimeFormat(locale, {
      month: long ? 'long' : 'short',
      year: long ? 'numeric' : '2-digit',
      timeZone: 'UTC',
    }).format(d);
  }
  // day / week (week keyed by its Monday)
  const d = new Date(`${period}T12:00:00Z`);
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    ...(long ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(d);
}

const buckets = $derived(data?.buckets ?? []);
const showCert = $derived(buckets.some((b) => b.cert > 0));
const maxTotal = $derived(Math.max(1, ...buckets.map((b) => b.sign + b.verify + b.cert)));
const hasActivity = $derived(buckets.some((b) => b.sign + b.verify + b.cert > 0));
const active = $derived(buckets.length === 0 ? null : buckets[activeIndex ?? buckets.length - 1]);

function pct(value: number): number {
  return (value / maxTotal) * 100;
}

/** Bottom→top stack segments present in a bucket (single accent + neutral). */
function segmentsOf(b: Bucket): { key: string; value: number; cls: string }[] {
  const segs = [
    { key: 'sign', value: b.sign, cls: 'bg-brand-500' },
    { key: 'verify', value: b.verify, cls: 'bg-ink-400 dark:bg-ink-500' },
  ];
  if (showCert) segs.push({ key: 'cert', value: b.cert, cls: 'bg-brand-300 dark:bg-brand-700' });
  return segs.filter((s) => s.value > 0);
}

/** Sparse x-axis labels: all when few, else endpoints + a stride. */
function showAxisLabel(i: number): boolean {
  const n = buckets.length;
  if (n <= 12) return true;
  if (i === 0 || i === n - 1) return true;
  return i % Math.ceil(n / 6) === 0;
}

async function load(g: Granularity): Promise<void> {
  phase = 'loading';
  activeIndex = null;
  try {
    const res = await fetch(`${resolveBase()}/api/stats/series?granularity=${g}`, {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json()) as SeriesResponse;
    totals = data.totals; // keep last-known totals; never null them on a later error
    phase = data.buckets.length > 0 ? 'ready' : 'empty';
  } catch (e) {
    // Honest degradation: surface the error UI, but don't swallow context silently.
    console.warn('stats: series load failed', e);
    data = null;
    phase = 'error';
  }
}

// Silent reload (no skeleton flash) for the live granularities' auto-refresh.
async function refresh(g: Granularity): Promise<void> {
  try {
    const res = await fetch(`${resolveBase()}/api/stats/series?granularity=${g}`, {
      cache: 'no-store',
    });
    if (!res.ok) return;
    const d = (await res.json()) as SeriesResponse;
    if (granularity !== g) return; // user switched while the request was in flight
    data = d;
    totals = d.totals;
    phase = d.buckets.length > 0 ? 'ready' : 'empty';
  } catch (e) {
    console.warn('stats: refresh failed', e);
  }
}

function selectGranularity(g: Granularity): void {
  if (g === granularity) return;
  granularity = g;
  void load(g);
}

onMount(() => {
  reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  void load(granularity);
});

// Keep the live-ish views (minute/hour) fresh without a manual reload.
$effect(() => {
  if (granularity !== 'minute' && granularity !== 'hour') return;
  const g = granularity;
  const id = setInterval(() => void refresh(g), 60_000);
  return () => clearInterval(id);
});
</script>

<section aria-labelledby="stats-heading" class="container py-12 md:py-16">
  <!-- Running totals — kept across granularity changes; "—" until first load. -->
  <dl class="flex flex-wrap gap-x-10 gap-y-6">
    {#each totalStats as stat (stat.key)}
      <div class="flex flex-col-reverse gap-1.5">
        <dt class="text-xs font-medium uppercase tracking-wider text-ink-500">{stat.label}</dt>
        <dd class="font-display text-3xl sm:text-4xl font-semibold leading-none tracking-tight tabular-nums text-ink-900 dark:text-ink-50">
          {#if totals}{nf.format(totals[stat.key])}{#if totals[stat.key] > 0}<span class="text-brand-500">+</span>{/if}{:else}<span class="text-ink-300 dark:text-ink-700">—</span>{/if}
        </dd>
      </div>
    {/each}
  </dl>

  <!-- Granularity selector -->
  <div
    class="mt-10 inline-flex max-w-full flex-wrap gap-y-1 rounded-lg bg-ink-100 p-1 dark:bg-ink-900"
    role="group"
    aria-label={labels.granularity}
  >
    {#each GRANULARITIES as g (g)}
      <button
        type="button"
        class="rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
        class:bg-white={granularity === g}
        class:shadow-sm={granularity === g}
        class:text-ink-900={granularity === g}
        class:dark:bg-ink-700={granularity === g}
        class:dark:text-ink-50={granularity === g}
        class:text-ink-500={granularity !== g}
        aria-pressed={granularity === g}
        onclick={() => selectGranularity(g)}
      >
        {labels[g]}
      </button>
    {/each}
  </div>

  <!-- overflow-x-clip absorbs the ±few-px spill of centered edge axis labels so
       the page never gains a horizontal scrollbar on narrow viewports. -->
  <div class="mt-6 overflow-x-clip">
    {#if phase === 'loading'}
      <!-- Reserve the same rows the ready state renders (readout/axis/legend/since)
           so loading→ready (and every granularity switch) doesn't reflow. -->
      <div aria-hidden="true">
        <div class="min-h-[1.5rem]"></div>
        <div class="mt-3 h-52 sm:h-64 flex items-end justify-center gap-1">
          {#each Array.from({ length: 16 }) as _, i (i)}
            <div
              class="flex-1 max-w-[3rem] rounded-t bg-ink-200/70 dark:bg-ink-800 animate-pulse"
              style={`height:${20 + ((i * 37) % 70)}%`}
            ></div>
          {/each}
        </div>
        <div class="mt-2 h-3"></div>
        <div class="mt-5 h-3 w-44 rounded bg-ink-200/60 dark:bg-ink-800/70 animate-pulse"></div>
        <div class="mt-4 h-3 w-56 rounded bg-ink-200/40 dark:bg-ink-800/60 animate-pulse"></div>
      </div>
    {:else if phase === 'error'}
      <div class="rounded-lg border border-ink-200 dark:border-ink-800 px-6 py-10 text-center">
        <p class="font-display text-base font-semibold text-ink-900 dark:text-ink-50">{labels.errorTitle}</p>
        <p class="mt-1 text-sm text-ink-600 dark:text-ink-400">{labels.errorBody}</p>
        <button
          type="button"
          class="mt-5 inline-flex items-center h-10 px-4 rounded-md bg-brand-500 text-white text-sm font-semibold ring-1 ring-brand-600/30 hover:-translate-y-px transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
          onclick={() => load(granularity)}
        >
          {labels.retry}
        </button>
      </div>
    {:else if phase === 'empty' || !hasActivity}
      <div class="rounded-lg border border-dashed border-ink-300 dark:border-ink-700 px-6 py-12 text-center">
        <p class="font-display text-base font-semibold text-ink-900 dark:text-ink-50">{labels.emptyTitle}</p>
        <p class="mt-1 text-sm text-ink-600 dark:text-ink-400 max-w-prose mx-auto">{labels.emptyBody}</p>
        <button
          type="button"
          class="mt-5 inline-flex items-center h-9 px-3.5 rounded-md text-sm font-medium text-ink-700 dark:text-ink-300 ring-1 ring-ink-300 dark:ring-ink-700 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
          onclick={() => load(granularity)}
        >
          {labels.retry}
        </button>
      </div>
    {:else}
      <!-- Readout: surfaces the active bucket (hover/focus, else latest) -->
      <div class="flex flex-wrap items-baseline gap-x-6 gap-y-1 min-h-[1.5rem]" aria-hidden="true">
        {#if active}
          <span class="text-sm font-medium text-ink-700 dark:text-ink-300">{formatPeriod(active.period, granularity, true)}</span>
          <span class="text-sm text-ink-600 dark:text-ink-400">
            <span class="inline-block h-2.5 w-2.5 rounded-sm bg-brand-500 align-middle"></span>
            <span class="tabular-nums font-medium text-ink-900 dark:text-ink-50">{nf.format(active.sign)}</span> {labels.signed}
          </span>
          <span class="text-sm text-ink-600 dark:text-ink-400">
            <span class="inline-block h-2.5 w-2.5 rounded-sm bg-ink-400 dark:bg-ink-500 align-middle"></span>
            <span class="tabular-nums font-medium text-ink-900 dark:text-ink-50">{nf.format(active.verify)}</span> {labels.verified}
          </span>
          {#if showCert}
            <span class="text-sm text-ink-600 dark:text-ink-400">
              <span class="inline-block h-2.5 w-2.5 rounded-sm bg-brand-300 dark:bg-brand-700 align-middle"></span>
              <span class="tabular-nums font-medium text-ink-900 dark:text-ink-50">{nf.format(active.cert)}</span> {labels.certs}
            </span>
          {/if}
        {:else}
          <span class="text-sm text-ink-500">{labels.readoutHint}</span>
        {/if}
      </div>

      <!-- Chart: stacked bars. The visually-hidden table below is the accessible
           source of truth; each bar is still a labelled button for keyboard/SR.
           justify-center keeps sparse views (year/week/month) from clustering
           left with dead space; the dense day view fills the row regardless. -->
      <div class="mt-3 h-52 sm:h-64 flex items-end justify-center gap-px sm:gap-1">
        {#each buckets as b, i (b.period)}
          {@const segs = segmentsOf(b)}
          <button
            type="button"
            class="group relative flex-1 min-w-0 max-w-[3rem] h-full flex flex-col-reverse justify-start focus-visible:outline-none"
            aria-label={`${formatPeriod(b.period, granularity, true)}: ${nf.format(b.sign)} ${labels.signed}, ${nf.format(b.verify)} ${labels.verified}${showCert ? `, ${nf.format(b.cert)} ${labels.certs}` : ''}`}
            onmouseenter={() => (activeIndex = i)}
            onfocus={() => (activeIndex = i)}
            onmouseleave={() => (activeIndex = null)}
            onblur={() => (activeIndex = null)}
          >
            <span
              class="pointer-events-none absolute inset-0 rounded-t bg-brand-500/0 transition-colors duration-150 group-hover:bg-brand-500/5 group-focus-visible:bg-brand-500/10"
            ></span>
            {#each segs as s, si (s.key)}
              <!-- min-h-[2px]: a real (value>0) period never vanishes sub-pixel
                   against a tall max, which would falsely read as zero activity. -->
              <span
                class={`block w-full min-h-[2px] ${s.cls} bar-seg`}
                class:rounded-t={si === segs.length - 1}
                class:bar-anim={!reducedMotion}
                style={`height:${pct(s.value)}%; --d:${i * 18}ms`}
              ></span>
            {/each}
          </button>
        {/each}
      </div>

      <!-- X axis (same justify as the bar row so labels stay under their bars) -->
      <div class="mt-2 flex justify-center gap-px sm:gap-1" aria-hidden="true">
        {#each buckets as b, i (b.period)}
          <div class="flex-1 min-w-0 max-w-[3rem] text-center">
            {#if showAxisLabel(i)}
              <span class="text-[10px] leading-tight text-ink-500 tabular-nums whitespace-nowrap">
                {formatPeriod(b.period, granularity)}
              </span>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Legend -->
      <div class="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-600 dark:text-ink-400">
        <span class="inline-flex items-center gap-1.5">
          <span class="h-2.5 w-2.5 rounded-sm bg-brand-500"></span>{labels.signed}
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="h-2.5 w-2.5 rounded-sm bg-ink-400 dark:bg-ink-500"></span>{labels.verified}
        </span>
        {#if showCert}
          <span class="inline-flex items-center gap-1.5">
            <span class="h-2.5 w-2.5 rounded-sm bg-brand-300 dark:bg-brand-700"></span>{labels.certs}
          </span>
        {/if}
      </div>

      {#if data?.since}
        <p class="mt-4 text-xs text-ink-500">{labels.sincePrefix} {formatPeriod(data.since, 'day', true)}.</p>
      {/if}

      <!-- Accessible data table (visually hidden; the chart is the visual form).
           Wrapped in a 1px sr-only DIV: UnoCSS's sr-only clip alone doesn't
           shrink a <table> (auto table-layout keeps its content width), so the
           bare table overflowed the viewport on mobile. The 1px block box clips
           it for real while keeping it readable to assistive tech. -->
      <div class="sr-only w-px h-px">
        <table>
          <caption>{labels.tableCaption}</caption>
          <thead>
          <tr>
            <th scope="col">{labels.colPeriod}</th>
            <th scope="col">{labels.signed}</th>
            <th scope="col">{labels.verified}</th>
            {#if showCert}<th scope="col">{labels.certs}</th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each buckets as b (b.period)}
            <tr>
              <th scope="row">{formatPeriod(b.period, granularity, true)}</th>
              <td>{nf.format(b.sign)}</td>
              <td>{nf.format(b.verify)}</td>
              {#if showCert}<td>{nf.format(b.cert)}</td>{/if}
            </tr>
          {/each}
        </tbody>
        </table>
      </div>
    {/if}
  </div>
</section>

<style>
  .bar-seg {
    transform-origin: bottom;
  }
  .bar-anim {
    animation: grow-in 600ms cubic-bezier(0.16, 1, 0.3, 1) both;
    animation-delay: var(--d, 0ms);
  }
  @keyframes grow-in {
    from {
      transform: scaleY(0);
    }
    to {
      transform: scaleY(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar-anim {
      animation: none;
    }
  }
</style>
