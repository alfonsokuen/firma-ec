<script lang="ts">
  let count = $state(0);
</script>

<main>
  <h1>app.firma.ec</h1>
  <p>PWA de firma y verificación. Estado: F0 setup smoke.</p>
  <button type="button" on:click={() => count++}>Smoke counter: {count}</button>
</main>

<style>
  main { font-family: system-ui, sans-serif; padding: 2rem; max-width: 60ch; margin-inline: auto; }
  h1 { font-size: clamp(1.5rem, 4vw, 2.5rem); }
  button { font-size: 1rem; padding: 0.5rem 1rem; min-height: 44px; min-width: 44px; }
</style>
