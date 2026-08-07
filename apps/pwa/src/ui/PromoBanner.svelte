<script lang="ts">
/**
 * Cinta temporal "Oferta Independencia" — espejo de
 * `apps/landing/src/components/PromoBanner.astro`, adaptado a Svelte 5
 * runes (la PWA no tiene build-time gating por ruta: el corte de fecha
 * corre siempre en el cliente).
 */
import { onMount } from 'svelte';
import { getLang } from '../lib/i18n.svelte.ts';
import { storeLink } from '../lib/storeLink.ts';

const href = storeLink('promo-banner-app');

const PROMO_STARTS_AT = '2026-08-07T00:00:00-05:00';
const PROMO_ENDS_AT = '2026-08-11T23:59:59-05:00';
const DISMISS_KEY = 'promo-banner-independencia-dismissed';

const copy = {
  es: {
    message: 'Oferta Independencia: firma electrónica hasta 38% más barata (planes de 1 a 5 años)',
    until: 'Solo hasta el 11 de agosto',
    cta: 'Ver oferta',
    dismiss: 'Cerrar aviso de oferta',
  },
  en: {
    message: 'Independence Day offer: e-signature certificates up to 38% off (1–5 year plans)',
    until: 'Through August 11 only',
    cta: 'See offer',
    dismiss: 'Dismiss offer banner',
  },
} as const;

const t = $derived(copy[getLang() === 'en' ? 'en' : 'es']);

let visible = $state(false);

onMount(() => {
  try {
    if (localStorage.getItem(DISMISS_KEY) === '1') return;
  } catch (_) {
    /* localStorage bloqueado: seguimos, solo se pierde el "recordar cerrado" */
  }
  const now = Date.now();
  const starts = new Date(PROMO_STARTS_AT).getTime();
  const ends = new Date(PROMO_ENDS_AT).getTime();
  if (now >= starts && now <= ends) visible = true;
});

function dismiss(): void {
  visible = false;
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch (_) {
    /* noop */
  }
}
</script>

{#if visible}
  <div
    role="region"
    aria-label={getLang() === 'en' ? 'Limited-time offer' : 'Oferta por tiempo limitado'}
    class="relative overflow-hidden text-sm font-medium"
    style="background:#C9821E;color:#11201a"
  >
    <a
      {href}
      target="_blank"
      rel="noopener noreferrer"
      data-cta="promo_banner_click"
      class="promo-track group flex items-center gap-2 h-11 pr-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink-950/40"
    >
      <span class="promo-track-inner flex shrink-0 items-center gap-2 whitespace-nowrap will-change-transform">
        {#each [0, 1] as copyIndex (copyIndex)}
          <span class="flex items-center gap-2 px-4" aria-hidden={copyIndex === 1}>
            <span class="font-bold uppercase tracking-wide">{t.until}</span>
            <span>{t.message}</span>
            <span class="inline-flex items-center gap-1 font-bold underline-offset-2 group-hover:underline">
              {t.cta}
              <span class="i-lucide-arrow-right text-base" aria-hidden="true"></span>
            </span>
          </span>
        {/each}
      </span>
    </a>
    <button
      type="button"
      aria-label={t.dismiss}
      onclick={dismiss}
      class="absolute right-0.5 top-0.5 inline-flex items-center justify-center w-10 h-10 rounded-md hover:bg-ink-950/10 active:bg-ink-950/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-950/40"
    >
      <span class="i-lucide-x text-lg" aria-hidden="true"></span>
    </button>
  </div>
{/if}

<style>
  .promo-track-inner {
    animation: promo-marquee 22s linear infinite;
  }
  .promo-track:hover .promo-track-inner,
  .promo-track:focus-within .promo-track-inner {
    animation-play-state: paused;
  }
  @keyframes promo-marquee {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(-50%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .promo-track-inner {
      animation: none;
      justify-content: center;
      width: 100%;
    }
    .promo-track-inner > :global(span:nth-child(2)) {
      display: none;
    }
  }
</style>
