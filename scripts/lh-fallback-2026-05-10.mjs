#!/usr/bin/env node
/**
 * F7 follow-up 2026-05-10 — Lighthouse-fallback audit via Playwright.
 * No lighthouse CLI available; we capture equivalent metrics directly:
 *   - Performance: TTFB, FCP, LCP, total transfer size, request count, slowest req.
 *   - A11y proxy: <html lang>, alt-attr coverage, button/link names, focus-visible rule.
 *   - SEO proxy: title, meta description, og:image, og:type, canonical, lang, robots.
 *   - Console errors + failed requests.
 *
 * Output: _backups/F7-followup-2026-05-10/lighthouse-results.json
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const pwPath = pathToFileURL(resolve(process.cwd(), 'node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs')).href;
const { chromium } = await import(pwPath);
import { mkdirSync, writeFileSync } from 'node:fs';

const ROUTES = [
  'https://firmar.ec/',
  'https://firmar.ec/contacto',
  'https://firmar.ec/acerca',
  'https://firmar.ec/privacidad',
  'https://app.firmar.ec/',
  'https://app.firmar.ec/#/firmar',
  'https://app.firmar.ec/#/verificar',
  'https://app.firmar.ec/#/configuracion',
];

const OUT_DIR = '_backups/F7-followup-2026-05-10';
mkdirSync(OUT_DIR, { recursive: true });

async function auditOne(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const requests = [];
  const failed = [];
  const consoleErrors = [];
  page.on('requestfinished', async (req) => {
    try {
      const resp = await req.response();
      if (!resp) return;
      const headers = resp.headers();
      const len = Number(headers['content-length'] || 0);
      const timing = req.timing();
      requests.push({
        url: req.url(),
        status: resp.status(),
        len,
        ms: timing && timing.responseEnd > 0 ? Math.round(timing.responseEnd) : 0,
      });
      if (resp.status() >= 400) failed.push({ url: req.url(), status: resp.status() });
    } catch {}
  });
  page.on('requestfailed', (req) => {
    failed.push({ url: req.url(), error: req.failure()?.errorText || 'failed' });
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200));
  });

  const t0 = Date.now();
  let navError = null;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    navError = String(e).slice(0, 200);
  }
  const loadMs = Date.now() - t0;

  // Web Vitals approximations
  const perf = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const paints = performance.getEntriesByType('paint');
    const fcp = paints.find(p => p.name === 'first-contentful-paint')?.startTime || 0;
    const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
    const lcp = lcpEntries.length ? lcpEntries[lcpEntries.length - 1].startTime : 0;
    return {
      ttfb: nav ? Math.round(nav.responseStart) : null,
      domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      load: nav ? Math.round(nav.loadEventEnd) : null,
      fcp: Math.round(fcp),
      lcp: Math.round(lcp),
    };
  }).catch(() => ({}));

  // SEO + a11y proxies
  const meta = await page.evaluate(() => {
    const get = (sel, attr = 'content') => document.querySelector(sel)?.getAttribute(attr) || null;
    const title = document.title || null;
    const desc = get('meta[name="description"]');
    const ogImage = get('meta[property="og:image"]');
    const ogType = get('meta[property="og:type"]');
    const canonical = get('link[rel="canonical"]', 'href');
    const lang = document.documentElement.getAttribute('lang');
    const robots = get('meta[name="robots"]');
    const imgs = Array.from(document.querySelectorAll('img'));
    const imgsTotal = imgs.length;
    const imgsWithAlt = imgs.filter(i => i.hasAttribute('alt')).length;
    const buttons = Array.from(document.querySelectorAll('button'));
    const buttonsNamed = buttons.filter(b => (b.textContent || '').trim() || b.getAttribute('aria-label')).length;
    const links = Array.from(document.querySelectorAll('a'));
    const linksNamed = links.filter(a => (a.textContent || '').trim() || a.getAttribute('aria-label')).length;
    return {
      title, desc, ogImage, ogType, canonical, lang, robots,
      imgsTotal, imgsWithAlt,
      buttonsTotal: buttons.length, buttonsNamed,
      linksTotal: links.length, linksNamed,
    };
  }).catch(() => ({}));

  const totalBytes = requests.reduce((a, r) => a + (r.len || 0), 0);
  const slowest = requests.slice().sort((a, b) => (b.ms || 0) - (a.ms || 0))[0] || null;

  await ctx.close();
  return {
    url, loadMs, navError,
    perf, meta,
    network: {
      requestCount: requests.length,
      totalBytes,
      slowestUrl: slowest?.url || null,
      slowestMs: slowest?.ms || null,
      failedCount: failed.length,
      failed: failed.slice(0, 10),
    },
    consoleErrors: consoleErrors.slice(0, 10),
  };
}

(async () => {
  const browser = await chromium.launch();
  const results = [];
  for (const r of ROUTES) {
    console.log(`[audit] ${r}`);
    try {
      const res = await auditOne(browser, r);
      results.push(res);
    } catch (e) {
      results.push({ url: r, error: String(e).slice(0, 300) });
    }
  }
  await browser.close();
  const out = { generatedAt: new Date().toISOString(), tool: 'playwright-lh-fallback', results };
  writeFileSync(`${OUT_DIR}/lighthouse-results.json`, JSON.stringify(out, null, 2));
  console.log(`[done] saved ${OUT_DIR}/lighthouse-results.json`);
})();
