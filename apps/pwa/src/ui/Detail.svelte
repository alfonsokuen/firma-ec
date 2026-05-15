<script lang="ts">
/**
 * Detail.svelte â€” expandable technical detail panel.
 *
 * Surfaces every field present in `VerificationResult`: signer subject CN/O/OU,
 * issuer, validity period, hash & signature algorithms, OCSP status & source,
 * warnings list, signing time, integrity (digestMatches), incremental updates,
 * fingerprint, matched root, engine version, verifiedAt timestamp.
 *
 * Uses `<details>` for native progressive disclosure (works without JS).
 */
import type { OcspStatus, VerificationResult } from '@firma-ec/verifier';
import { type UIKey, t } from '../lib/i18n.svelte.ts';

interface Props {
  result: VerificationResult;
}

const { result }: Props = $props();

function ocspStatusLabel(s: OcspStatus['status']): string {
  const k = `detail.ocsp_${s}` as UIKey;
  return t(k);
}
function ocspSourceLabel(s: OcspStatus['source']): string {
  const k = `detail.ocsp_source_${s}` as UIKey;
  return t(k);
}

function formatDate(iso?: string | undefined): string {
  if (!iso) return t('detail.none');
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatBytes(n?: number | undefined): string {
  if (n === undefined) return t('detail.none');
  return n.toLocaleString();
}

function shortFingerprint(fp?: string | undefined): string {
  if (!fp) return t('detail.none');
  // pretty-print as XX:XX:XXâ€¦ for readability
  return (
    fp
      .match(/.{1,2}/g)
      ?.join(':')
      .toUpperCase() ?? fp
  );
}
</script>

<details class="group w-full rounded-2xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 overflow-hidden">
  <summary
    class="
      list-none cursor-pointer select-none px-7 py-4 min-h-12
      flex items-center justify-between gap-4
      text-base font-medium text-ink-700 dark:text-ink-100
      hover:bg-ink-100 dark:hover:bg-ink-800/60 transition-colors
      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950
    "
  >
    <span class="flex items-center gap-2">
      <span class="i-lucide-info text-base text-brand-500" aria-hidden="true"></span>
      {t('detail.title')}
    </span>
    <span class="i-lucide-chevron-down text-base text-ink-500 transition-transform group-open:rotate-180" aria-hidden="true"></span>
  </summary>

  <div class="px-7 py-6 border-t border-ink-200 dark:border-ink-800 flex flex-col gap-7 text-sm">

    {#if result.signer}
      <section>
        <h3 class="font-display font-semibold text-ink-700 dark:text-ink-100 mb-3">
          {t('detail.signer')}
        </h3>
        <dl class="grid sm:grid-cols-2 gap-x-6 gap-y-2">
          <div>
            <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.signer_cn')}</dt>
            <dd class="font-medium text-ink-700 dark:text-ink-100 break-words">{result.signer.cert.subject.cn ?? t('detail.none')}</dd>
          </div>
          <div>
            <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.signer_o')}</dt>
            <dd class="font-medium text-ink-700 dark:text-ink-100 break-words">{result.signer.cert.subject.o ?? t('detail.none')}</dd>
          </div>
          <div>
            <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.signer_ou')}</dt>
            <dd class="font-medium text-ink-700 dark:text-ink-100 break-words">{result.signer.cert.subject.ou ?? t('detail.none')}</dd>
          </div>
          <div>
            <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.signer_serial')}</dt>
            <dd class="font-mono text-ink-700 dark:text-ink-100 break-words">{result.signer.cert.subject.serialNumber ?? t('detail.none')}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h3 class="font-display font-semibold text-ink-700 dark:text-ink-100 mb-3">
          {t('detail.issuer')}
        </h3>
        <dl class="grid sm:grid-cols-2 gap-x-6 gap-y-2">
          <div>
            <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.issuer_cn')}</dt>
            <dd class="font-medium text-ink-700 dark:text-ink-100 break-words">{result.signer.cert.issuer.cn ?? t('detail.none')}</dd>
          </div>
          <div>
            <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.issuer_o')}</dt>
            <dd class="font-medium text-ink-700 dark:text-ink-100 break-words">{result.signer.cert.issuer.o ?? t('detail.none')}</dd>
          </div>
          {#if result.signer.matchedRootName}
            <div class="sm:col-span-2">
              <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.matched_root')}</dt>
              <dd class="font-medium text-ink-700 dark:text-ink-100">
                {result.signer.matchedRootName}
                {#if result.signer.matchedRootSlug}
                  <span class="text-ink-500 font-mono text-xs ml-2">({result.signer.matchedRootSlug})</span>
                {/if}
              </dd>
            </div>
          {/if}
        </dl>
      </section>

      <section>
        <h3 class="font-display font-semibold text-ink-700 dark:text-ink-100 mb-3">
          {t('detail.validity')}
        </h3>
        <dl class="grid sm:grid-cols-2 gap-x-6 gap-y-2">
          <div>
            <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.valid_from')}</dt>
            <dd class="font-mono text-ink-700 dark:text-ink-100">{formatDate(result.signer.cert.validFrom)}</dd>
          </div>
          <div>
            <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.valid_until')}</dt>
            <dd class="font-mono text-ink-700 dark:text-ink-100">{formatDate(result.signer.cert.validUntil)}</dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.fingerprint')}</dt>
            <dd class="font-mono text-xs text-ink-700 dark:text-ink-100 break-all">{shortFingerprint(result.signer.cert.fingerprintSha256)}</dd>
          </div>
        </dl>
      </section>
    {/if}

    {#if result.signature}
      <section>
        <h3 class="font-display font-semibold text-ink-700 dark:text-ink-100 mb-3">
          {t('detail.signature')}
        </h3>
        <dl class="grid sm:grid-cols-2 gap-x-6 gap-y-2">
          <div>
            <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.profile')}</dt>
            <dd class="font-mono text-ink-700 dark:text-ink-100">{result.signature.profile}</dd>
          </div>
          <div>
            <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.digest_algo')}</dt>
            <dd class="font-mono text-ink-700 dark:text-ink-100 break-all">{result.signature.digestAlgo}</dd>
          </div>
          <div>
            <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.sig_algo')}</dt>
            <dd class="font-mono text-ink-700 dark:text-ink-100 break-all">{result.signature.signatureAlgo}</dd>
          </div>
          <div>
            <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.signing_time')}</dt>
            <dd class="font-mono text-ink-700 dark:text-ink-100">{formatDate(result.signature.signingTime)}</dd>
          </div>
          {#if result.signature.timestampTime}
            <div>
              <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.timestamp_time')}</dt>
              <dd class="font-mono text-ink-700 dark:text-ink-100">{formatDate(result.signature.timestampTime)}</dd>
            </div>
          {/if}
          {#if result.signature.reason}
            <div>
              <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.reason')}</dt>
              <dd class="text-ink-700 dark:text-ink-100 break-words">{result.signature.reason}</dd>
            </div>
          {/if}
          {#if result.signature.location}
            <div>
              <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.location')}</dt>
              <dd class="text-ink-700 dark:text-ink-100 break-words">{result.signature.location}</dd>
            </div>
          {/if}
          {#if result.signature.contactInfo}
            <div>
              <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.contact')}</dt>
              <dd class="text-ink-700 dark:text-ink-100 break-words">{result.signature.contactInfo}</dd>
            </div>
          {/if}
        </dl>
      </section>
    {/if}

    {#if result.integrity}
      <section>
        <h3 class="font-display font-semibold text-ink-700 dark:text-ink-100 mb-3">
          {t('detail.integrity')}
        </h3>
        <dl class="grid sm:grid-cols-2 gap-x-6 gap-y-2">
          <div>
            <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.digest_match')}</dt>
            <dd class="font-medium" class:text-ok-500={result.integrity.digestMatches} class:text-err-500={!result.integrity.digestMatches}>
              {result.integrity.digestMatches ? t('detail.digest_match_yes') : t('detail.digest_match_no')}
            </dd>
          </div>
          <div>
            <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.incremental')}</dt>
            <dd class="font-medium" class:text-warn-500={result.integrity.hasIncrementalUpdates} class:text-ok-500={!result.integrity.hasIncrementalUpdates}>
              {result.integrity.hasIncrementalUpdates ? t('detail.incremental_yes') : t('detail.incremental_no')}
            </dd>
          </div>
          <div>
            <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.covered_bytes')}</dt>
            <dd class="font-mono text-ink-700 dark:text-ink-100">{formatBytes(result.integrity.coveredBytes)}</dd>
          </div>
          <div>
            <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.total_bytes')}</dt>
            <dd class="font-mono text-ink-700 dark:text-ink-100">{formatBytes(result.integrity.totalBytes)}</dd>
          </div>
        </dl>
      </section>
    {/if}

    {#if result.ocsp}
      <section>
        <h3 class="font-display font-semibold text-ink-700 dark:text-ink-100 mb-3">
          {t('detail.ocsp')}
        </h3>
        <dl class="grid sm:grid-cols-2 gap-x-6 gap-y-2">
          <div>
            <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.ocsp_status')}</dt>
            <dd class="font-medium" class:text-ok-500={result.ocsp.status === 'good'} class:text-err-500={result.ocsp.status === 'revoked'} class:text-warn-500={result.ocsp.status === 'unknown'} class:text-ink-500={result.ocsp.status === 'not_checked'}>
              {ocspStatusLabel(result.ocsp.status)}
            </dd>
          </div>
          <div>
            <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.ocsp_source')}</dt>
            <dd class="font-mono text-ink-700 dark:text-ink-100">{ocspSourceLabel(result.ocsp.source)}</dd>
          </div>
          {#if result.ocsp.checkedAt}
            <div>
              <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.ocsp_checked_at')}</dt>
              <dd class="font-mono text-ink-700 dark:text-ink-100">{formatDate(result.ocsp.checkedAt)}</dd>
            </div>
          {/if}
          {#if result.ocsp.revokedAt}
            <div>
              <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.ocsp_revoked_at')}</dt>
              <dd class="font-mono text-err-500">{formatDate(result.ocsp.revokedAt)}</dd>
            </div>
          {/if}
          {#if result.ocsp.reason}
            <div class="sm:col-span-2">
              <dt class="text-ink-600 dark:text-ink-400 text-xs uppercase tracking-wide font-medium">{t('detail.ocsp_reason')}</dt>
              <dd class="text-ink-700 dark:text-ink-100 break-words">{result.ocsp.reason}</dd>
            </div>
          {/if}
        </dl>
      </section>
    {/if}

    {#if result.warnings.length > 0}
      <section>
        <h3 class="font-display font-semibold text-warn-500 mb-3 flex items-center gap-2">
          <span class="i-lucide-alert-triangle text-base" aria-hidden="true"></span>
          {t('detail.warnings')} ({result.warnings.length})
        </h3>
        <ul class="flex flex-col gap-2">
          {#each result.warnings as w (w.code + w.message)}
            <li class="rounded-lg border border-warn-500/30 bg-warn-500/5 px-4 py-2">
              <p class="font-mono text-xs text-warn-500 mb-0.5">{w.code}</p>
              <p class="text-ink-700 dark:text-ink-200 break-words">{w.message}</p>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if result.error}
      <section>
        <h3 class="font-display font-semibold text-err-500 mb-2 flex items-center gap-2">
          <span class="i-lucide-x-circle text-base" aria-hidden="true"></span>
          {t('detail.engine_error')}
        </h3>
        <p class="font-mono text-xs text-ink-700 dark:text-ink-200 break-all rounded-lg border border-err-500/30 bg-err-500/5 px-4 py-2">
          {result.error}
        </p>
      </section>
    {/if}

    <section class="pt-2 border-t border-ink-200 dark:border-ink-800">
      <dl class="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-ink-500 font-mono">
        <div class="flex gap-2">
          <dt>{t('detail.engine_version')}:</dt>
          <dd>{result.engineVersion}</dd>
        </div>
        <div class="flex gap-2">
          <dt>{t('detail.verified_at')}:</dt>
          <dd>{formatDate(result.verifiedAt)}</dd>
        </div>
      </dl>
    </section>

  </div>
</details>

