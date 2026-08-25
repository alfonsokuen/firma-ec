<script lang="ts">
/**
 * Footer.svelte — visual parity with `apps/landing/src/components/Footer.astro`
 * (rediseño 0.6.14: headers eyebrow mono, ritmo uniforme de links, tarjeta de
 * privacidad). Layout: 3-col grid (lockup+desc+IDK / project links / privacy
 * card) + bottom strip with copyright + version + security.txt link.
 *
 * Privacy claim ("Sin tracking. Sin cuentas.") stays — it's a meaningful
 * PWA-specific statement that the landing intentionally lacks; now framed as
 * a tinted card so it reads as a differentiator, not a floating footnote.
 *
 * a11y: <footer> implies role="contentinfo" — no extra ARIA needed.
 */
import { link } from 'svelte-spa-router';
import { getLang, t } from '../lib/i18n.svelte.ts';
import { storeLink } from '../lib/storeLink.ts';
import { APP_VERSION } from '../lib/version.ts';
import IdkmanagerMark from './IdkmanagerMark.svelte';

const year = new Date().getFullYear();
const buyUrl = storeLink('footer');

const linkBase =
  'flex items-center gap-1.5 py-1.5 min-h-11 md:min-h-8 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded';
</script>

<footer class="border-t border-ink-200 dark:border-ink-800 mt-16 bg-ink-100/40 dark:bg-ink-900/20">
  <div class="container max-w-6xl mx-auto px-4 py-12 grid gap-10 md:gap-8 md:grid-cols-[1.3fr_1fr_1.1fr]">
    <!-- Lockup + description + IDKMANAGER credit -->
    <div>
      <p class="font-display text-lg font-bold tracking-tight">
        <span class="text-brand-500">firmar</span><span class="text-ink-500">.ec</span>
        <span class="ml-1 text-[10px] font-mono text-ink-500 dark:text-ink-400 bg-ink-100 dark:bg-ink-800 px-1.5 py-0.5 rounded align-middle">app</span>
      </p>
      <p class="mt-3 text-sm text-ink-600 dark:text-ink-400 max-w-prose leading-relaxed">
        {t('footer.description')}
      </p>
      <p class="mt-4 text-xs text-ink-500 flex items-center flex-wrap gap-x-2 gap-y-1">
        <span>{t('footer.operated_by')}</span>
        <a
          class="inline-flex items-center gap-1.5 text-ink-700 dark:text-ink-300 hover:text-brand-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950 rounded"
          href="https://idkmanager.com/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="IDKMANAGER — idkmanager.com"
        >
          <IdkmanagerMark size="sm" />
          <span class="i-lucide-arrow-up-right text-xs opacity-60" aria-hidden="true"></span>
        </a>
      </p>
    </div>

    <!-- Project links -->
    <div>
      <h3 class="text-xs font-mono uppercase tracking-wider text-ink-500 dark:text-ink-400 mb-4">
        {t('footer.project')}
      </h3>
      <ul class="text-sm text-ink-600 dark:text-ink-400">
        <li>
          <a href="/about" use:link class="{linkBase} hover:text-ink-900 dark:hover:text-ink-50">
            {t('footer.about_link')}
          </a>
        </li>
        <li>
          <a
            href="https://firmar.ec/"
            target="_blank"
            rel="noopener noreferrer"
            class="{linkBase} hover:text-ink-900 dark:hover:text-ink-50"
          >
            <span>{t('footer.institutional')}</span>
            <span class="i-lucide-arrow-up-right text-xs opacity-60" aria-hidden="true"></span>
          </a>
        </li>
        <li>
          <a
            href={buyUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="{linkBase} font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
          >
            <span class="i-lucide-shopping-bag text-sm" aria-hidden="true"></span>
            <span>{getLang() === 'es' ? 'Comprar certificado' : 'Buy a certificate'}</span>
            <span class="i-lucide-arrow-up-right text-xs opacity-60" aria-hidden="true"></span>
          </a>
        </li>
        <li>
          <a
            href="https://firmar.ec/patrocinar/"
            target="_blank"
            rel="noopener noreferrer"
            class="{linkBase} text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
          >
            <span class="i-lucide-sparkles text-sm" aria-hidden="true"></span>
            <span>{t('footer.sponsor')}</span>
          </a>
        </li>
        <li>
          <a
            href="https://github.com/idkmanager/firmar-ec"
            target="_blank"
            rel="noopener noreferrer"
            class="{linkBase} hover:text-ink-900 dark:hover:text-ink-50 font-mono text-xs"
          >
            <span class="i-lucide-github text-base" aria-hidden="true"></span>
            <span>github.com/idkmanager</span>
          </a>
        </li>
      </ul>
    </div>

    <!-- Privacy claim (PWA-specific differentiator) as a tinted card -->
    <div>
      <h3 class="text-xs font-mono uppercase tracking-wider text-ink-500 dark:text-ink-400 mb-4">
        {t('footer.privacy_heading')}
      </h3>
      <div class="flex items-start gap-3 rounded-xl border border-ok-500/25 bg-ok-500/[0.05] dark:bg-ok-500/[0.07] p-4">
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ok-500/12"
          aria-hidden="true"
        >
          <span class="i-lucide-shield-check text-ok-500 text-lg"></span>
        </span>
        <p class="m-0 text-sm text-ink-700 dark:text-ink-300 leading-relaxed">
          {t('footer.privacy_claim')}
        </p>
      </div>
    </div>
  </div>

  <!-- Bottom strip — landing parity -->
  <div class="border-t border-ink-200 dark:border-ink-800">
    <div class="container max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 py-4 text-xs text-ink-500">
      <p class="flex items-center flex-wrap gap-x-2 gap-y-1">
        <span>© {year} firmar.ec · {t('footer.licencia')}</span>
        <span class="hidden sm:inline text-ink-400 dark:text-ink-600" aria-hidden="true">·</span>
        <span class="font-mono">
          {t('footer.version_label')} <span class="text-brand-500">{APP_VERSION}</span>
        </span>
      </p>
      <p>
        <a
          href="https://firmar.ec/.well-known/security.txt"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-ink-700 dark:hover:text-ink-300 transition-colors"
        >security.txt</a>
      </p>
    </div>
  </div>
</footer>
