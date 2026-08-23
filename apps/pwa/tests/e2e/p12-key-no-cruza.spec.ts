import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * E2E — la clave privada del .p12 no cruza al hilo principal (regresión de seguridad).
 *
 * Los tests unitarios prueban el módulo del worker contra un `self` falso. Esto
 * lo prueba sobre la RUTA REAL en un navegador de verdad: se instrumenta
 * `window.Worker` para grabar TODO lo que la página recibe por `message` desde
 * cualquier worker, y luego se recorre el wizard de /#/firmar con un .p12 real
 * hasta firmar. Si algún mensaje trae `privateKeyPkcs8Der` o un buffer con los
 * bytes de la clave, se detecta aquí — no en una revisión de código.
 *
 * @see apps/pwa/src/lib/workers/p12-result.ts (la compuerta)
 * @see apps/pwa/src/lib/workers/p12.worker.security.test.ts (unitario, mismo invariante)
 */
import { parsePfx } from '@firma-ec/signer';
import { type Page, expect, test } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = resolve(HERE, 'fixtures/sample.pdf');
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const FIXTURE_P12_VALID = resolve(REPO_ROOT, 'packages/signer/tests/fixtures/rsa2048-valid.p12');
const VALID_PIN = 'test1234';

interface WorkerMessageProbe {
  workerName: string;
  /** Rutas donde aparece una propiedad con nombre de material de clave. */
  keyPaths: string[];
  /** Rutas de buffers que contienen los bytes REALES de la clave del fixture. */
  keyByteHits: string[];
  /** Bytes totales transportados en ArrayBuffers/vistas dentro del mensaje. */
  bufferBytes: number;
  kind: string;
}

/**
 * Extrae del .p12 de prueba el PKCS#8 real, para buscar SUS bytes en lo que
 * recibe la página. Es la prueba que un renombrado del campo no puede evadir:
 * no busca un nombre, busca la clave.
 */
async function realKeyPrefix(): Promise<number[]> {
  const bytes = new Uint8Array(readFileSync(FIXTURE_P12_VALID));
  const parsed = (await parsePfx(bytes, VALID_PIN)) as unknown as {
    privateKeyPkcs8Der: ArrayBuffer;
    signingCert: { der: Uint8Array };
  };
  const der = new Uint8Array(parsed.privateKeyPkcs8Der);
  // El tramo debe ser EXCLUSIVO de la parte privada. Ojo: el módulo RSA `n`
  // (primeros ~300 bytes del PKCS#8) también viaja dentro del certificado, que
  // sí es público — apuntar ahí daba un falso positivo. Al final del DER están
  // dp/dq/qInv, que no existen fuera de la clave privada.
  const needle = Array.from(der.slice(der.length - 80, der.length - 48));

  // Auto-validación: si el patrón apareciera en el certificado, el test estaría
  // midiendo lo público y su verde no valdría nada.
  const cert = new Uint8Array(parsed.signingCert.der);
  const inCert = (() => {
    outer: for (let i = 0; i + needle.length <= cert.length; i++) {
      for (let j = 0; j < needle.length; j++) if (cert[i + j] !== needle[j]) continue outer;
      return true;
    }
    return false;
  })();
  if (inCert) throw new Error('patrón de clave no exclusivo: aparece en el certificado público');
  return needle;
}

/**
 * Instrumenta `Worker` ANTES de que cargue la app: cada worker que la página
 * cree queda con un listener propio que audita los mensajes entrantes.
 * Se ejecuta en el contexto de la página, por eso va como string-function.
 */
async function instrumentWorkers(page: Page, keyNeedle: number[]): Promise<void> {
  await page.addInitScript((needle: number[]) => {
    const SECRET_PROPS = ['privateKeyPkcs8Der', 'privateKey', 'pkcs8'];
    const probes: WorkerMessageProbe[] = [];
    (window as unknown as { __workerProbes: WorkerMessageProbe[] }).__workerProbes = probes;

    function hasNeedle(bytes: Uint8Array): boolean {
      if (needle.length === 0 || bytes.length < needle.length) return false;
      outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
        for (let j = 0; j < needle.length; j++) {
          if (bytes[i + j] !== needle[j]) continue outer;
        }
        return true;
      }
      return false;
    }

    function scan(
      value: unknown,
      path: string,
      acc: { keyPaths: string[]; keyByteHits: string[]; bufferBytes: number },
      seen: Set<object>,
    ): void {
      if (value === null || typeof value !== 'object') return;
      if (seen.has(value as object)) return;
      seen.add(value as object);
      if (value instanceof ArrayBuffer) {
        acc.bufferBytes += value.byteLength;
        if (hasNeedle(new Uint8Array(value))) acc.keyByteHits.push(path);
        return;
      }
      if (ArrayBuffer.isView(value)) {
        const v = value as ArrayBufferView;
        acc.bufferBytes += v.byteLength;
        if (hasNeedle(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)))
          acc.keyByteHits.push(path);
        return;
      }
      for (const k of Object.keys(value as Record<string, unknown>)) {
        const here = `${path}.${k}`;
        if (SECRET_PROPS.includes(k)) acc.keyPaths.push(here);
        scan((value as Record<string, unknown>)[k], here, acc, seen);
      }
    }

    const NativeWorker = window.Worker;
    class AuditedWorker extends NativeWorker {
      constructor(url: string | URL, opts?: WorkerOptions) {
        super(url, opts);
        const name = opts?.name ?? String(url);
        super.addEventListener('message', (ev: MessageEvent) => {
          const acc = { keyPaths: [] as string[], keyByteHits: [] as string[], bufferBytes: 0 };
          scan(ev.data, '$', acc, new Set<object>());
          probes.push({
            workerName: name,
            kind: (ev.data as { kind?: string } | null)?.kind ?? '(sin kind)',
            keyPaths: acc.keyPaths,
            keyByteHits: acc.keyByteHits,
            bufferBytes: acc.bufferBytes,
          });
        });
      }
    }
    window.Worker = AuditedWorker as unknown as typeof Worker;
  }, keyNeedle);
}

async function runWizardUntilSigned(page: Page): Promise<void> {
  await page.goto('/#/firmar');

  const pdfInput = page.locator('input[type="file"]').first();
  await pdfInput.waitFor({ state: 'attached' });
  await pdfInput.setInputFiles(FIXTURE_PDF);
  await expect(
    page.getByRole('heading', { name: /coloca tu cuadro|place your signature/i }),
  ).toBeVisible({ timeout: 15_000 });

  await page.locator('.box-overlay').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('.sig-box').waitFor({ state: 'visible', timeout: 10_000 });
  await page
    .getByRole('button', { name: /^continuar$|^continue$/i })
    .last()
    .click();
  await expect(
    page.getByRole('heading', { name: /tu certificado|your \.p12 certificate/i }),
  ).toBeVisible({ timeout: 10_000 });

  const p12Input = page.locator('input[type="file"]').first();
  await p12Input.waitFor({ state: 'attached' });
  await p12Input.setInputFiles(FIXTURE_P12_VALID);
  await expect(
    page.getByRole('heading', {
      name: /escribe tu contraseña|enter your password|tu contraseña|password/i,
    }),
  ).toBeVisible({ timeout: 10_000 });

  const pinInput = page
    .locator('input[type="password"], input[type="text"][autocomplete="off"]')
    .first();
  await pinInput.waitFor({ state: 'visible' });
  await pinInput.fill(VALID_PIN);
  await pinInput.press('Enter');

  await expect(page.getByRole('heading', { name: /listo para firmar|ready to sign/i })).toBeVisible(
    {
      timeout: 10_000,
    },
  );
  await page.getByRole('button', { name: /^firmar pdf$|^sign pdf$/i }).click();
  await expect(
    page.getByRole('heading', { name: /pdf firmado correctamente|pdf signed successfully/i }),
  ).toBeVisible({ timeout: 30_000 });
}

test.describe('seguridad — la clave privada no cruza al hilo principal', () => {
  test('ningún mensaje worker→página lleva material de clave, y la firma termina bien', async ({
    page,
  }) => {
    const keyNeedle = await realKeyPrefix();
    expect(keyNeedle.length).toBe(32); // el fixture tiene que dar clave real
    await instrumentWorkers(page, keyNeedle);
    await runWizardUntilSigned(page);

    const probes = await page.evaluate(
      () => (window as unknown as { __workerProbes: WorkerMessageProbe[] }).__workerProbes,
    );

    // El wizard tuvo que hablar con el worker de p12 y con el de firma: si no
    // hay mensajes, la instrumentación no midió nada y el verde no vale.
    expect(probes.length).toBeGreaterThan(0);
    const p12Results = probes.filter((p) => p.workerName.includes('p12') && p.kind === 'result');
    expect(p12Results.length).toBeGreaterThan(0);

    // (a) por nombre de campo
    const byName = probes.filter((p) => p.keyPaths.length > 0);
    expect(
      byName,
      `mensajes con un campo de material de clave: ${JSON.stringify(byName, null, 2)}`,
    ).toEqual([]);

    // (b) por CONTENIDO: los bytes reales del PKCS#8 de este .p12. Un
    // renombrado del campo no evade esta comprobación.
    const byBytes = probes.filter((p) => p.keyByteHits.length > 0);
    expect(
      byBytes,
      `mensajes que transportan los bytes de la clave: ${JSON.stringify(byBytes, null, 2)}`,
    ).toEqual([]);
  });
});
