<script lang="ts">
import { onMount } from 'svelte';

// Tema en 3 estados: auto (sigue al sistema, en vivo) → claro → oscuro.
// Se persiste el MODO ('auto'|'light'|'dark') en localStorage 'theme'; el
// bootstrap de index.html trata cualquier valor ≠ light/dark como auto, así
// que 'auto' es retro y forward-compatible. En auto, un listener de
// matchMedia re-aplica el tema si el sistema cambia con la app abierta.
type Mode = 'auto' | 'light' | 'dark';

let mode = $state<Mode>('auto');
let media: MediaQueryList | null = null;

function apply(m: Mode): void {
  const resolved = m === 'auto' ? (media?.matches ? 'dark' : 'light') : m;
  document.documentElement.dataset['theme'] = resolved;
}

function cycle(): void {
  mode = mode === 'auto' ? 'light' : mode === 'light' ? 'dark' : 'auto';
  apply(mode);
  try {
    localStorage.setItem('theme', mode);
  } catch (_) {}
}

onMount(() => {
  media = window.matchMedia('(prefers-color-scheme: dark)');
  try {
    const saved = localStorage.getItem('theme');
    mode = saved === 'light' || saved === 'dark' ? saved : 'auto';
  } catch (_) {
    mode = 'auto';
  }
  const onMedia = () => {
    if (mode === 'auto') apply('auto');
  };
  media.addEventListener('change', onMedia);
  return () => media?.removeEventListener('change', onMedia);
});

interface Props {
  labelToggle: string;
  labelLight: string;
  labelDark: string;
  labelSystem: string;
}
let { labelToggle, labelLight, labelDark, labelSystem }: Props = $props();

const modeLabel = $derived(
  mode === 'auto' ? labelSystem : mode === 'light' ? labelLight : labelDark,
);
</script>

<button
  type="button"
  onclick={cycle}
  aria-label={`${labelToggle}: ${modeLabel}`}
  title={`${labelToggle}: ${modeLabel}`}
  class="inline-flex items-center justify-center min-w-11 min-h-11 rounded-md hover:bg-ink-100 dark:hover:bg-ink-800 active:scale-[0.96] transition-[background-color,transform] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]"
>
  {#if mode === 'auto'}
    <span class="i-lucide-monitor text-lg" aria-hidden="true"></span>
  {:else if mode === 'light'}
    <span class="i-lucide-sun text-lg" aria-hidden="true"></span>
  {:else}
    <span class="i-lucide-moon text-lg" aria-hidden="true"></span>
  {/if}
  <span class="sr-only">{modeLabel}</span>
</button>
