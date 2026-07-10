<script lang="ts">
/**
 * CertHelp.svelte — modo guiado, pre-pregunta del paso 3: "¿Tienes tu
 * archivo de firma?". [Sí, lo tengo] continúa al DropP12 estándar (el
 * caller decide qué renderizar); [No tengo / no sé] despliega la ayuda con
 * dos salidas reales — comprar en la tienda o escribir por WhatsApp — sin
 * bloquear al usuario (plan §1, "Paso 3 — pre-pregunta").
 */
import { t } from '../../lib/i18n.svelte.ts';
import { STORE_URL, WHATSAPP_URL } from '../../lib/links.ts';

interface Props {
  onHave: () => void;
  /** Fix B (revisión F2): callback aditivo — dispara narración `cert_no` en
   *  el caller sin acoplar este componente al motor de voz. Opcional para no
   *  romper la API existente. */
  onNoHave?: () => void;
}

const { onHave, onNoHave }: Props = $props();

let showHelp = $state(false);

function handleNoHave(): void {
  showHelp = true;
  onNoHave?.();
}
</script>

<div class="cert-help">
  <h2 class="cert-title">{t('guided.cert.title')}</h2>
  <p class="cert-question">{t('guided.cert.question')}</p>

  {#if !showHelp}
    <div class="cert-actions">
      <button type="button" class="btn-primary" onclick={onHave}>
        {t('guided.cert.yes')}
      </button>
      <button type="button" class="btn-secondary" onclick={handleNoHave}>
        {t('guided.cert.no')}
      </button>
    </div>
  {:else}
    <div class="cert-help-panel" role="region" aria-live="polite">
      <p>{t('guided.cert.help')}</p>
      <div class="cert-actions">
        <a class="btn-primary" href={STORE_URL} target="_blank" rel="noopener">
          {t('guided.cert.buy')}
        </a>
        <a class="btn-whatsapp" href={WHATSAPP_URL} target="_blank" rel="noopener">
          <span class="i-lucide-message-circle" aria-hidden="true"></span>
          {t('guided.cert.whatsapp')}
        </a>
      </div>
    </div>
  {/if}
</div>

<style>
  .cert-help {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    text-align: center;
  }
  .cert-title {
    font-weight: 700;
  }
  .cert-question {
    font-weight: 500;
  }
  .cert-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.75rem;
  }
  .cert-help-panel {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .btn-primary,
  .btn-secondary,
  .btn-whatsapp {
    min-height: 60px;
    padding: 0.75rem 1.5rem;
    border-radius: var(--r-lg, 12px);
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    text-decoration: none;
  }
  .btn-primary {
    /* AAA a11y (F3b): brand-500 con texto blanco no llega a 4.5:1
       (contraste medido 4.04:1 con axe-core color-contrast). brand-600 sí. */
    background: var(--brand-600);
    color: white;
    border: none;
  }
  .btn-primary:hover {
    background: oklch(38% 0.18 245);
  }
  .btn-secondary {
    background: transparent;
    border: 2px solid var(--ink-300, oklch(85% 0 0));
    color: var(--ink-700);
  }
  .btn-secondary:hover {
    background: var(--ink-100, oklch(95% 0 0));
  }
  .btn-whatsapp {
    /* AAA a11y (F3b): oklch(64% ...) con texto blanco medía 3.13:1 con
       axe-core color-contrast (necesita 4.5:1). Oscurecido a 38% L. */
    background: oklch(38% 0.14 155);
    color: white;
    border: none;
  }
  .btn-whatsapp:hover {
    background: oklch(33% 0.14 155);
  }
</style>
