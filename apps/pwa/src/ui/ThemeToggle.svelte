<script lang="ts">
import { onMount } from 'svelte';

let theme = $state<'light' | 'dark'>('light');

onMount(() => {
  theme = document.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'light';
});

function toggle() {
  const next = theme === 'dark' ? 'light' : 'dark';
  theme = next;
  document.documentElement.dataset['theme'] = next;
  try {
    localStorage.setItem('theme', next);
  } catch (_) {}
}

interface Props {
  labelToggle: string;
  labelLight: string;
  labelDark: string;
}
let { labelToggle, labelLight, labelDark }: Props = $props();
</script>

<button
  type="button"
  onclick={toggle}
  aria-label={labelToggle}
  aria-pressed={theme === 'dark'}
  class="inline-flex items-center justify-center min-w-11 min-h-11 rounded-md hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors"
>
  {#if theme === 'dark'}
    <span class="i-lucide-sun text-lg" aria-hidden="true"></span>
    <span class="sr-only">{labelLight}</span>
  {:else}
    <span class="i-lucide-moon text-lg" aria-hidden="true"></span>
    <span class="sr-only">{labelDark}</span>
  {/if}
</button>
