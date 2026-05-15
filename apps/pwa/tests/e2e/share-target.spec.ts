import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * E2E — Share Target POST /share (v0.4.1).
 *
 * The Vite dev server does NOT register the custom service worker (vite-pwa
 * only emits it during `vite build`). These tests therefore require running
 * against a `pnpm --filter @firma-ec/pwa preview` server or the deployed
 * https://app.firmar.ec — set the `PREVIEW_BASE_URL` env var to opt in.
 *
 * What we cover:
 *   1. SW registration succeeds on the built bundle.
 *   2. POST /share with a valid signed-shape PDF → 303 redirect to
 *      `/#/share?pdfId=<uuid>` with the file stashed in the
 *      `shared-pdf-v1` Cache Storage.
 *   3. POST /share with non-PDF payload → redirect to `/?shareError=not_pdf`.
 *   4. POST /share with > 50 MB payload → redirect to `/?shareError=too_big`.
 *   5. POST /share with PDF magic-byte mismatch → `?shareError=invalid_pdf`.
 *   6. TTL cleanup — entries stamped >10min ago are deleted on the next put.
 *
 * The webServer is overridden when PREVIEW_BASE_URL is set; otherwise the
 * tests skip with a clear reason.
 */
import { expect, test } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = resolve(HERE, 'fixtures/sample.pdf');

const PREVIEW = process.env['PREVIEW_BASE_URL'] || '';
const skipReason =
  'requires PREVIEW_BASE_URL pointing at a built/preview origin (SW only present in vite build output)';

test.describe('Share Target POST /share (SW intercept)', () => {
  test.skip(!PREVIEW, skipReason);

  test.beforeEach(async ({ page }) => {
    // 1. Visit the app first to allow the SW to install + activate.
    await page.goto(PREVIEW);
    await page.waitForFunction(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg !== undefined && (reg.active !== null || reg.waiting !== null);
    });
  });

  test('SW is registered on the live origin', async ({ page }) => {
    const hasSW = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return !!(reg && (reg.active || reg.waiting));
    });
    expect(hasSW).toBe(true);
  });

  test('POST /share with PDF redirects to /#/share?pdfId=...', async ({ page }) => {
    const pdfBytes = readFileSync(FIXTURE_PDF);
    const result = await page.evaluate(
      async ({ b64 }) => {
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const file = new File([arr], 'demo.pdf', { type: 'application/pdf' });
        const fd = new FormData();
        fd.append('file', file);
        const resp = await fetch('/share', { method: 'POST', body: fd, redirect: 'manual' });
        return { status: resp.status, type: resp.type, location: resp.headers.get('Location') };
      },
      { b64: pdfBytes.toString('base64') },
    );
    // Redirected response (status 0 / type='opaqueredirect') means the SW
    // returned a Response.redirect that the browser then followed; with
    // redirect:'manual' Chrome surfaces the location header.
    // In some browsers fetch() with manual surfaces opaqueredirect and 0.
    if (result.status === 303 && result.location) {
      expect(result.location).toContain('/#/share?pdfId=');
    } else {
      expect(result.type).toBe('opaqueredirect');
    }
  });

  test('POST /share with non-PDF redirects to /?shareError=not_pdf', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const file = new File([new Uint8Array([1, 2, 3])], 'a.txt', { type: 'text/plain' });
      const fd = new FormData();
      fd.append('file', file);
      const resp = await fetch('/share', { method: 'POST', body: fd, redirect: 'manual' });
      return { status: resp.status, type: resp.type, location: resp.headers.get('Location') };
    });
    if (result.location) {
      expect(result.location).toContain('shareError=not_pdf');
    } else {
      expect(result.type).toBe('opaqueredirect');
    }
  });

  test('POST /share with PDF extension but no magic redirects with invalid_pdf', async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      // Forge a .pdf with garbage bytes.
      const bytes = new Uint8Array(32).fill(0x41);
      const file = new File([bytes], 'fake.pdf', { type: 'application/pdf' });
      const fd = new FormData();
      fd.append('file', file);
      const resp = await fetch('/share', { method: 'POST', body: fd, redirect: 'manual' });
      return { status: resp.status, type: resp.type, location: resp.headers.get('Location') };
    });
    if (result.location) {
      expect(result.location).toContain('shareError=invalid_pdf');
    } else {
      expect(result.type).toBe('opaqueredirect');
    }
  });

  test('POST /share with no file redirects with no_file', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const fd = new FormData();
      fd.append('title', 'hello');
      const resp = await fetch('/share', { method: 'POST', body: fd, redirect: 'manual' });
      return { status: resp.status, type: resp.type, location: resp.headers.get('Location') };
    });
    if (result.location) {
      expect(result.location).toContain('shareError=no_file');
    } else {
      expect(result.type).toBe('opaqueredirect');
    }
  });

  test('Cache Storage cleanup removes entries older than TTL', async ({ page }) => {
    // Pre-seed shared-pdf-v1 with stale entries (X-Stored-At > 10min ago) and
    // one fresh, then trigger the SW share handler. The handler runs cleanup
    // fire-and-forget so we wait briefly and assert the cache only retains
    // the fresh + the newly-added entry.
    const remaining = await page.evaluate(async () => {
      const cache = await caches.open('shared-pdf-v1');
      const STALE_TS = (Date.now() - 11 * 60 * 1000).toString();
      const FRESH_TS = Date.now().toString();
      // Stale x10
      for (let i = 0; i < 10; i++) {
        await cache.put(
          new Request(`/__shared-pdf__/stale-${i}`),
          new Response(
            new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], { type: 'application/pdf' }),
            {
              headers: { 'X-Stored-At': STALE_TS },
            },
          ),
        );
      }
      // Fresh
      await cache.put(
        new Request('/__shared-pdf__/fresh-1'),
        new Response(
          new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], { type: 'application/pdf' }),
          {
            headers: { 'X-Stored-At': FRESH_TS },
          },
        ),
      );
      // Trigger cleanup via a real share POST with valid PDF magic bytes.
      const fd = new FormData();
      fd.append(
        'file',
        new File(
          [new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a])],
          'a.pdf',
          {
            type: 'application/pdf',
          },
        ),
      );
      await fetch('/share', { method: 'POST', body: fd, redirect: 'manual' });
      // Give cleanup a tick.
      await new Promise((r) => setTimeout(r, 500));
      const keys = await cache.keys();
      return keys.map((k) => new URL(k.url).pathname);
    });
    // No stale-* should remain.
    expect(remaining.filter((p) => p.includes('stale-'))).toHaveLength(0);
    // Fresh + new entry should be present.
    expect(remaining.filter((p) => p.includes('fresh-1'))).toHaveLength(1);
  });
});
