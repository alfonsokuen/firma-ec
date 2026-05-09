<script lang="ts">
  import { t } from '../lib/i18n.svelte.ts';
  import BundleHashBadge from '../ui/BundleHashBadge.svelte';
  const APP_VERSION = '0.2.3-dev';
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
</section>
