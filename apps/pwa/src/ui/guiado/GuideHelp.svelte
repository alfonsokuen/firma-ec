<script lang="ts">
/**
 * GuideHelp.svelte — ayuda contextual accesible del modo guiado (F3 pulido).
 *
 * `<details>` nativo en vez de tooltip hover: funciona con teclado, touch y
 * lector de pantalla sin JS extra, y respeta el plan (§5, "sin tooltips
 * hover — usar <details> '¿Por qué lo piden?'").
 */
import { type UIKey, t } from '../../lib/i18n.svelte.ts';

interface Props {
  /** Clave i18n del `<summary>` (la pregunta, p.ej. "¿Por qué me piden esto?"). */
  summaryKey: UIKey;
  /** Clave i18n del cuerpo (la respuesta llana). */
  bodyKey: UIKey;
}

const { summaryKey, bodyKey }: Props = $props();
</script>

<details class="guide-help">
  <summary>{t(summaryKey)}</summary>
  <p>{t(bodyKey)}</p>
</details>

<style>
  .guide-help {
    border: 2px solid var(--ink-200, oklch(90% 0 0));
    border-radius: var(--r-lg, 12px);
    padding: 0.75rem 1rem;
    background: var(--ink-50, oklch(97% 0 0));
  }
  .guide-help summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 1.05rem;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 44px;
  }
  .guide-help summary::-webkit-details-marker {
    display: none;
  }
  .guide-help summary::before {
    content: '?';
    flex: none;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    /* AAA a11y (F3b): brand-500 con texto blanco no llega a 4.5:1
       (contraste medido 4.04:1 con axe-core color-contrast). brand-600 sí. */
    background: var(--brand-600);
    color: white;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.9rem;
  }
  .guide-help p {
    margin: 0.5rem 0 0 2rem;
    color: var(--ink-600, oklch(45% 0 0));
  }
  :global([data-theme='dark']) .guide-help {
    background: var(--ink-900, oklch(20% 0 0));
    border-color: var(--ink-700, oklch(35% 0 0));
  }
  :global([data-theme='dark']) .guide-help p {
    color: var(--ink-300, oklch(75% 0 0));
  }
</style>
