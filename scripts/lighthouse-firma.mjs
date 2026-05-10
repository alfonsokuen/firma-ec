#!/usr/bin/env node
/**
 * scripts/lighthouse-firma.mjs — F6 §Task 21.
 *
 * Runs Lighthouse against the three F6 routes and dumps JSON + HTML reports
 * into `_backups/lighthouse-F6-<YYYY-MM-DD>/`. No assertions: this is the
 * harness that produces the artifacts an operator inspects post-deploy.
 *
 * Requirements (install once globally or locally):
 *   npm i -g lighthouse chrome-launcher
 *   # or:
 *   pnpm add -Dw lighthouse chrome-launcher
 *
 * Usage:
 *   node scripts/lighthouse-firma.mjs
 *   # override base URL (e.g. staging):
 *   FIRMA_BASE_URL=https://staging.firmar.ec node scripts/lighthouse-firma.mjs
 *   # narrow to a single route:
 *   FIRMA_ROUTES="/#/firmar" node scripts/lighthouse-firma.mjs
 *
 * Mozilla Observatory + axe-core notes:
 *   - axe-core scans run inside Playwright (`tests/e2e/tsa-flow.spec.ts` —
 *     extended in a follow-up to inject @axe-core/playwright). This script
 *     only handles Lighthouse.
 *   - Mozilla Observatory has no CLI shipped here; verify manually after
 *     deploying the new CSP (which now includes https://freetsa.org in
 *     connect-src):
 *       https://observatory.mozilla.org/analyze/firmar.ec
 *       https://observatory.mozilla.org/analyze/app.firmar.ec
 *     A+ should be retained.
 *
 * Exit codes:
 *   0 — all routes scored.
 *   1 — Lighthouse not installed (instructions printed).
 *   2 — at least one route failed to launch / score.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

const BASE = process.env.FIRMA_BASE_URL ?? 'https://app.firmar.ec';
const ROUTES = (process.env.FIRMA_ROUTES ?? '/#/firmar,/#/verificar,/#/configuracion')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const today = new Date().toISOString().slice(0, 10);
const OUT_DIR = resolve(REPO_ROOT, '_backups', `lighthouse-F6-${today}`);

let lighthouse;
let chromeLauncher;
try {
  lighthouse = (await import('lighthouse')).default;
  chromeLauncher = await import('chrome-launcher');
} catch (e) {
  console.error('Lighthouse / chrome-launcher not installed.');
  console.error('Install with one of:');
  console.error('  npm i -g lighthouse chrome-launcher');
  console.error('  pnpm add -Dw lighthouse chrome-launcher');
  console.error('Original error:', e?.message ?? e);
  process.exit(1);
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const chrome = await chromeLauncher.launch({
  chromeFlags: ['--headless=new', '--no-sandbox'],
});

const baseOpts = {
  port: chrome.port,
  output: ['json', 'html'],
  logLevel: 'error',
  onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
};

let failed = 0;
const summary = [];

for (const route of ROUTES) {
  const url = `${BASE}${route}`;
  const slug = route.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'root';
  console.log(`[lighthouse] ${url}`);
  try {
    const runnerResult = await lighthouse(url, baseOpts, undefined);
    if (!runnerResult) throw new Error('lighthouse returned undefined');
    const [jsonReport, htmlReport] = runnerResult.report;
    writeFileSync(resolve(OUT_DIR, `${slug}.report.json`), jsonReport);
    writeFileSync(resolve(OUT_DIR, `${slug}.report.html`), htmlReport);
    const lhr = runnerResult.lhr;
    const scores = Object.fromEntries(
      Object.entries(lhr.categories).map(([k, v]) => [k, Math.round((v.score ?? 0) * 100)]),
    );
    console.log(`  scores: ${JSON.stringify(scores)}`);
    summary.push({ route, url, scores });
  } catch (err) {
    console.error(`  FAILED: ${err?.message ?? err}`);
    summary.push({ route, url, error: String(err?.message ?? err) });
    failed += 1;
  }
}

writeFileSync(
  resolve(OUT_DIR, 'summary.json'),
  JSON.stringify({ date: today, base: BASE, results: summary }, null, 2),
);
console.log(`\nWrote ${summary.length} reports to ${OUT_DIR}`);

await chrome.kill();
process.exit(failed > 0 ? 2 : 0);
