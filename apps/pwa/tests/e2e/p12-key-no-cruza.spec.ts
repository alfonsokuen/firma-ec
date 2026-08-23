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
 * hasta firmar. Si algún mensaje trae una propiedad con nombre de material de
 * clave, o un buffer, o un STRING con los bytes de la clave, se detecta aquí
 * — no en una revisión de código.
 *
 * El escaneo de strings no es un adorno: un JWK lleva sus componentes privados
 * (`d`, `p`, `q`, `dp`, `dq`, `qi`) en base64url. Mirando sólo `ArrayBuffer`s,
 * este test daba verde con la clave entera cruzando dentro de `privateKeyJwk`.
 *
 * @see apps/pwa/src/lib/workers/p12-result.ts (la compuerta)
 * @see apps/pwa/src/lib/workers/p12.worker.security.test.ts (unitario, mismo invariante)
 */
import { parsePfx } from '@firma-ec/signer';
import { type Page, expect, test } from '@playwright/test';
import {
  JWK_PROP,
  JWK_PUBLIC_PROPS,
  KEY_MATERIAL_PROPS,
} from '../../src/lib/workers/key-material-props';

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
  /** Rutas de strings que contienen los bytes REALES de la clave (base64url o crudo). */
  keyStringHits: string[];
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
  // Las listas viajan como DATO al contexto de la página (el callback se
  // serializa y no puede cerrar sobre el ámbito del test). Son las mismas que
  // usan los detectores unitarios: una sola lista para todo el repo.
  const cfg = {
    needle: keyNeedle,
    secretProps: [...KEY_MATERIAL_PROPS],
    jwkProp: JWK_PROP,
    jwkPublicProps: [...JWK_PUBLIC_PROPS],
  };
  await page.addInitScript((c: typeof cfg) => {
    const { needle, secretProps: SECRET_PROPS, jwkProp: JWK_KEY, jwkPublicProps } = c;
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

    /**
     * Codificaciones base64url del patrón para los 3 desfases posibles: el
     * patrón es un tramo INTERMEDIO de la clave, así que su base64 sólo aparece
     * literal si cae en la fase correcta de los grupos de 3 bytes.
     */
    const needleB64 = (() => {
      const out: string[] = [];
      for (let pad = 0; pad < 3; pad++) {
        const padded = new Uint8Array(pad + needle.length);
        padded.set(needle, pad);
        let bin = '';
        for (const b of padded) bin += String.fromCharCode(b);
        const std = btoa(bin).replace(/=+$/, '');
        // Recorta los caracteres contaminados por el relleno inicial y la cola.
        const start = Math.ceil((pad * 4) / 3);
        const stdCut = std.slice(start, std.length - 2);
        // 2026-08-23: ambas variantes del alfabeto — base64url Y estándar
        // (+/). El detector unitario ya cubre las dos; este e2e solo cubría
        // base64url y un JWK exportado con btoa() habría escapado.
        out.push(stdCut.replace(/\+/g, '-').replace(/\//g, '_'));
        out.push(stdCut);
      }
      return [...new Set(out)].filter((x) => x.length >= 16);
    })();

    /** Hex del tramo (byte-alineado, sin fases) — en minúscula; al comparar
     *  se normaliza el string bajo examen a minúscula. */
    const needleHex = Array.from(needle)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    /** Decodifica un string que parezca base64 (url o estándar); `null` si no lo es. */
    function decodeB64Url(text: string): Uint8Array | null {
      if (text.length < 16 || !/^[A-Za-z0-9+/_-]+=*$/.test(text)) return null;
      try {
        const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      } catch {
        return null;
      }
    }

    /**
     * Formas en que un string puede transportar la clave: base64 del tramo
     * (url o estándar, cualquiera de las 3 fases), base64 decodificable que
     * contenga los bytes, hex (cualquier caja), o bytes crudos en un string.
     */
    function stringCarriesKey(text: string): boolean {
      if (text.length < 16) return false;
      for (const enc of needleB64) if (text.includes(enc)) return true;
      if (text.toLowerCase().includes(needleHex)) return true;
      const decoded = decodeB64Url(text);
      if (decoded && hasNeedle(decoded)) return true;
      const raw = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) raw[i] = text.charCodeAt(i) & 0xff;
      return hasNeedle(raw);
    }

    interface ScanAcc {
      keyPaths: string[];
      keyByteHits: string[];
      keyStringHits: string[];
      bufferBytes: number;
    }

    function scan(value: unknown, path: string, acc: ScanAcc, seen: Set<object>): void {
      if (typeof value === 'string') {
        if (stringCarriesKey(value)) acc.keyStringHits.push(path);
        return;
      }
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
        const v = (value as Record<string, unknown>)[k];
        if (SECRET_PROPS.includes(k)) acc.keyPaths.push(here);
        // `privateKeyJwk` no se prohíbe por nombre (el tipo `ParsedPfx` lo
        // exige); se vigila por FORMA: sólo se admite el esqueleto público.
        if (k === JWK_KEY && v !== null && typeof v === 'object') {
          for (const inner of Object.keys(v as Record<string, unknown>)) {
            // La regla de nombre ya cubre los componentes conocidos; aquí sólo
            // lo que NO está en la lista (un miembro nuevo o renombrado).
            if (!jwkPublicProps.includes(inner) && !SECRET_PROPS.includes(inner))
              acc.keyPaths.push(`${here}.${inner}`);
          }
        }
        scan(v, here, acc, seen);
      }
    }

    const NativeWorker = window.Worker;
    class AuditedWorker extends NativeWorker {
      constructor(url: string | URL, opts?: WorkerOptions) {
        super(url, opts);
        const name = opts?.name ?? String(url);
        super.addEventListener('message', (ev: MessageEvent) => {
          const acc: ScanAcc = {
            keyPaths: [],
            keyByteHits: [],
            keyStringHits: [],
            bufferBytes: 0,
          };
          scan(ev.data, '$', acc, new Set<object>());
          probes.push({
            workerName: name,
            kind: (ev.data as { kind?: string } | null)?.kind ?? '(sin kind)',
            keyPaths: acc.keyPaths,
            keyByteHits: acc.keyByteHits,
            keyStringHits: acc.keyStringHits,
            bufferBytes: acc.bufferBytes,
          });
        });
      }
    }
    window.Worker = AuditedWorker as unknown as typeof Worker;
  }, cfg);
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

    // (c) por CONTENIDO en forma de STRING: un JWK lleva sus componentes
    // privados en base64url, invisibles a (b), que sólo mira buffers.
    const byString = probes.filter((p) => p.keyStringHits.length > 0);
    expect(
      byString,
      `mensajes que transportan la clave dentro de un string: ${JSON.stringify(byString, null, 2)}`,
    ).toEqual([]);
  });
});
