<script lang="ts">
import { onMount } from 'svelte';

let hash = $state<string | null>(null);

onMount(async () => {
  // Hash the SW bytes via Web Crypto — reflects the exact bundle the user is running
  try {
    const resp = await fetch('/sw.js', { cache: 'no-store' });
    const buf = await resp.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    hash = hex.slice(0, 16) + '…' + hex.slice(-4);
  } catch (_) {
    hash = 'n/a';
  }
});
</script>

<code
  class="text-xs font-mono text-ink-500 px-2 py-1 rounded bg-ink-100 dark:bg-ink-800"
  title="SHA-256 del Service Worker activo (primeros 16 + últimos 4 chars)"
>
  {hash ?? '…'}
</code>
