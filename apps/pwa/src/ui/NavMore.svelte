<script lang="ts">
import { link, router } from 'svelte-spa-router';
/**
 * NavMore.svelte — "Más" overflow menu for the desktop header.
 *
 * Collapses the secondary nav items (Paranoia · Acerca · Configuración) behind
 * a single trigger so the primary actions (Firmar · Firmar Fácil · Verificar ·
 * Validar certificado) keep room to breathe.
 *
 * Pattern: disclosure (button + list of links), NOT `role="menu"`. These are
 * navigation links, not menu commands, so a disclosure is the correct — and
 * simpler — ARIA pattern: no roving tabindex, normal Tab order through links.
 * Closes on Escape (focus returns to trigger), outside pointerdown, focus
 * leaving the container, and link activation.
 */
import { cubicOut } from 'svelte/easing';
import { scale } from 'svelte/transition';
import { type UIKey, t } from '../lib/i18n.svelte.ts';

let {
  items,
  onNavigate,
}: {
  items: Array<{ path: string; key: UIKey }>;
  onNavigate?: () => void;
} = $props();

let open = $state(false);
let triggerEl = $state<HTMLButtonElement | null>(null);
let containerEl = $state<HTMLElement | null>(null);

// Emil: reduced-motion means gentler, not zero — but a menu's scale/opacity is
// pure motion, so collapse the duration to an instant when the user opts out.
const prefersReducedMotion =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const openDuration = prefersReducedMotion ? 0 : 180;

/** true when the current route lives inside this menu — mirror it on the trigger. */
const containsActive = $derived(items.some((i) => i.path === router.location));

function close(): void {
  open = false;
}

function onFocusOut(e: FocusEvent): void {
  const next = e.relatedTarget as Node | null;
  if (!next || !containerEl?.contains(next)) open = false;
}

// While open, listen at the document level for the two dismissals that can
// originate outside the container: Escape (return focus to the trigger) and an
// outside pointerdown (capture phase, so it fires before the target's own
// handlers and closes even when the click lands on another interactive element).
$effect(() => {
  if (!open) return;
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      open = false;
      triggerEl?.focus();
    }
  }
  function onDocPointerDown(e: PointerEvent): void {
    if (!containerEl?.contains(e.target as Node)) open = false;
  }
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('pointerdown', onDocPointerDown, true);
  return () => {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('pointerdown', onDocPointerDown, true);
  };
});
</script>

<div
  class="relative"
  bind:this={containerEl}
  onfocusout={onFocusOut}
>
  <button
    type="button"
    bind:this={triggerEl}
    onclick={() => (open = !open)}
    aria-expanded={open}
    class="inline-flex items-center gap-1 h-11 px-3 rounded-md hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
    class:bg-ink-100={open}
    class:dark:bg-ink-800={open}
    class:text-brand-500={containsActive}
  >
    {t('nav.more')}
    <span
      class="i-lucide-chevron-down text-sm transition-transform duration-200 ease-out"
      class:rotate-180={open}
      aria-hidden="true"
    ></span>
  </button>

  {#if open}
    <ul
      transition:scale={{ duration: openDuration, start: 0.96, opacity: 0, easing: cubicOut }}
      style="transform-origin: top right;"
      class="absolute right-0 top-full mt-2 min-w-44 py-1 rounded-lg border border-ink-200 dark:border-ink-800 bg-ink-50/95 dark:bg-ink-950/95 backdrop-blur-md shadow-lg shadow-ink-950/10 dark:shadow-black/50 z-50"
    >
      {#each items as item (item.path)}
        <li>
          <a
            href={item.path}
            use:link
            onclick={() => {
              close();
              onNavigate?.();
            }}
            class="flex items-center h-11 px-3.5 text-sm rounded-md mx-1 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            class:text-brand-500={router.location === item.path}
          >
            {t(item.key)}
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</div>
