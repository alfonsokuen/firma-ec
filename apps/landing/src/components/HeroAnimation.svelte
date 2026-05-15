<script lang="ts">
import { onMount } from 'svelte';

let visible = $state(false);
let prefersReduced = $state(false);

onMount(() => {
  prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  requestAnimationFrame(() => {
    visible = true;
  });
});
</script>

<div
  class="hero-anim"
  class:visible
  class:reduced={prefersReduced}
>
  <slot />
</div>

<style>
  .hero-anim {
    opacity: 0;
    transform: translateY(8px);
    transition: opacity 600ms ease-out, transform 600ms ease-out;
  }
  .hero-anim.visible {
    opacity: 1;
    transform: translateY(0);
  }
  .hero-anim.reduced {
    transition: none;
    opacity: 1;
    transform: none;
  }
</style>
