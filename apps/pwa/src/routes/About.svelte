<script lang="ts">
  import { t } from '../lib/i18n.svelte.ts';
  import BundleHashBadge from '../ui/BundleHashBadge.svelte';
  import { APP_VERSION } from '../lib/version.ts';
</script>

<section class="container max-w-2xl mx-auto px-4 py-12">
  <h1 class="text-3xl font-display font-bold mb-4">{t('about.title')}</h1>
  <p class="text-ink-600 dark:text-ink-300 mb-6">
    {t('about.intro')}
  </p>
  <ul class="space-y-2 text-sm">
    <li>{t('about.version')}: <code class="font-mono text-brand-500">{APP_VERSION}</code></li>
    <li>{t('about.more_info')}: <a class="text-brand-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 rounded" href="https://firmar.ec/acerca">firmar.ec/acerca</a></li>
    <li>{t('about.license')}: <a class="text-brand-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 rounded" href="https://github.com/idkmanager/firma-ec/blob/main/LICENSE">Apache 2.0</a></li>
    <li>{t('about.report_issue')}: <a class="text-brand-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 rounded" href="https://github.com/idkmanager/firma-ec/issues">GitHub Issues</a></li>
  </ul>

  <div class="mt-8 flex items-center gap-3 rounded-xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 px-5 py-3">
    <span class="i-lucide-shield-check text-xl text-brand-500" aria-hidden="true"></span>
    <div class="flex-1 min-w-0">
      <p class="text-xs uppercase tracking-wide text-ink-600 dark:text-ink-400 font-medium">{t('about.bundle_hash')}</p>
      <BundleHashBadge />
    </div>
  </div>

  <section class="mt-8 rounded-xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 px-5 py-4" aria-labelledby="aces-heading">
    <h2 id="aces-heading" class="text-base font-semibold mb-2 flex items-center gap-2">
      <span class="i-lucide-badge-check text-lg text-brand-500" aria-hidden="true"></span>
      {t('about.aces_title')}
    </h2>
    <p class="text-sm text-ink-600 dark:text-ink-300 mb-3">{t('about.aces_body')}</p>
    <ul class="text-sm space-y-1">
      <li>
        <a
          class="text-brand-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 rounded"
          href="https://www.arcotel.gob.ec/listado-de-las-entidades-de-certificacion-de-informacion-y-servicios-relacionados-acreditados-y-terceros-vinculados-debidamente-acreditadas/"
          target="_blank"
          rel="noopener noreferrer"
        >{t('about.aces_link_arcotel')}</a>
      </li>
      <li>
        <a
          class="text-brand-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 rounded"
          href="https://www.sri.gob.ec/tramites-en-gob-ec"
          target="_blank"
          rel="noopener noreferrer"
        >{t('about.aces_link_sri')}</a>
      </li>
    </ul>
  </section>

  <!-- v0.4.0 — share target capability disclosure. -->
  <section class="mt-4 rounded-xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 px-5 py-4" aria-labelledby="share-cap-heading">
    <h2 id="share-cap-heading" class="text-base font-semibold mb-2 flex items-center gap-2">
      <span class="i-lucide-share-2 text-lg text-brand-500" aria-hidden="true"></span>
      {t('home.share_anchor.title')}
    </h2>
    <p class="text-sm text-ink-600 dark:text-ink-300">{t('about.share_target_capability')}</p>
  </section>

  <!-- v0.4.5 — QR-on-signature disclosure. -->
  <section class="mt-4 rounded-xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 px-5 py-4" aria-labelledby="qr-cap-heading">
    <h2 id="qr-cap-heading" class="text-base font-semibold mb-2 flex items-center gap-2">
      <span class="i-lucide-qr-code text-lg text-brand-500" aria-hidden="true"></span>
      {t('about.qr_title')}
    </h2>
    <p class="text-sm text-ink-600 dark:text-ink-300">{t('about.qr_description')}</p>
  </section>

  <!-- v0.4.8 — institutional site CTA (App ↔ Landing linkage). -->
  <a
    href="https://firmar.ec/acerca"
    target="_blank"
    rel="noopener noreferrer"
    class="mt-4 group flex items-start gap-4 rounded-xl border border-brand-500/20 bg-gradient-to-br from-brand-500/5 to-brand-500/0 px-5 py-4 hover:border-brand-500/40 hover:from-brand-500/10 hover:-translate-y-px transition-[transform,border-color,background] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
  >
    <span class="i-lucide-globe text-2xl text-brand-500 mt-0.5" aria-hidden="true"></span>
    <div class="flex-1 min-w-0">
      <h2 class="text-base font-semibold mb-1 flex items-center gap-2">
        {t('about.full_docs_cta_title')}
        <span class="i-lucide-arrow-up-right text-base text-brand-500 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true"></span>
      </h2>
      <p class="text-sm text-ink-600 dark:text-ink-300">{t('about.full_docs_cta_body')}</p>
      <span class="mt-2 inline-block text-xs font-mono text-brand-500">{t('about.full_docs_cta_link')}</span>
    </div>
  </a>
</section>
