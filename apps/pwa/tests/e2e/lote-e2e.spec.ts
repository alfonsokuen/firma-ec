/**
 * lote-e2e.spec.ts — E2E LOCAL de la firma por lotes, cruzando el Worker REAL.
 *
 * Qué cierra: los 135+136 tests verdes del lote sustituyen el worker por uno
 * falso (`__setSignSessionWorkerFactoryForTests`) — nada de eso producía un
 * PDF firmado real ni lo verificaba con código independiente del firmante.
 * `firmar-lote.spec.ts` YA cruza el worker real, pero conduciendo la UI y sin
 * verificación criptográfica propia (confía en lo que la app reporta). El
 * mérito NUEVO de este spec es justo eso: correr el mismo worker de sesión
 * auténtico y verificar cada salida con código INDEPENDIENTE del firmante
 * (ver `helpers/lote-verify.ts`: node:crypto + forge-como-parser para la
 * firma, pdf.js para la colocación "tal como se muestra").
 *
 * Por qué navegador real y no un runtime Node con Workers: el contrato del
 * lote vive en `Worker` de DOM (postMessage con transferables, `error`/
 * `messageerror`, terminate) + WebCrypto del navegador; un shim de Node
 * probaría otro sistema. Playwright + Vite ya están montados para esto.
 *
 * Instrumentación (criterio "una sesión, una clave"): `window.Worker` se
 * envuelve ANTES de cargar la app para contar (a) cuántos workers de sesión
 * se crean y (b) cuántos mensajes `openSession`/`signNext` viajan. La prueba
 * de que la clave se importó UNA vez es estructural: `parsePfx` solo corre en
 * `openSession` (ver sign-session.worker.ts) y aquí se observa exactamente 1
 * `openSession` frente a N `signNext` sobre 1 único worker.
 *
 * Local de verdad: los documentos limpios firman con timestamp/LTV apagados
 * (B-B, cero red); el caso degradado usa una ruta same-origin del dev server
 * que responde 404 (ver DEAD_TSA_URL) — el worker hace el fetch real, falla
 * rápido y sin tocar internet. Al final se afirma que TODA petición de red
 * observada fue al dev server local.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { computeAutoPlacement } from '../../../../packages/signer/src/autoPlacement.js';
import { readPageGeometry } from '../../../../packages/signer/src/pageGeometry.js';
import {
  CROP_X0,
  CROP_X1,
  CROP_Y0,
  CROP_Y1,
  LETTER_H_PT,
  LETTER_W_PT,
  buildMinimalPdf,
} from './helpers/lote-fixtures';
import {
  type PadesVerifyReport,
  findFinalByteRange,
  readDisplayedSealPlacement,
  verifyPadesIndependently,
} from './helpers/lote-verify';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');

/**
 * `.p12` efímero que `global-setup.ts` genera en cada corrida (RSA-2048,
 * autofirmado, CN "Prueba E2E") — no el fixture versionado de
 * `packages/signer/tests/fixtures` (caduca el 2027-05-09 y convertiría este
 * E2E en un rojo estacional). Mismo archivo que consumen
 * `firmar-facil.spec.ts` y `firmar-facil.a11y.spec.ts`.
 */
const FIXTURE_P12 = resolve(HERE, 'fixtures/generated/test-signer.p12');
/** PIN del `.p12` efímero — no es un secreto (clave de prueba, ver global-setup.ts). */
const FIXTURE_PIN = 'test1234';
/** CN del certificado autofirmado que `global-setup.ts` graba en el `.p12` efímero. */
const EXPECTED_SIGNER_CN = 'Prueba E2E';

/** Módulos de producción servidos por Vite (raíz = apps/pwa). */
const SESSION_BUS_URL = '/src/lib/workers/sign-session-bus.ts';
const SIGN_QUEUE_URL = '/src/lib/workers/sign-queue.ts';

// Tipos de los módulos importados DENTRO del navegador (se borran al
// transpilar; en runtime solo queda `import(url)` contra el dev server).
type SessionBusModule = typeof import('../../src/lib/workers/sign-session-bus');
type SignQueueModule = typeof import('../../src/lib/workers/sign-queue');

/**
 * TSA "muerta" para el caso degradado: ruta same-origin que el dev server NO
 * sirve → el worker hace un fetch REAL, recibe 404 y el tsa-client lo reporta
 * como fallo 'network'. Local y determinista (el tsa-client solo admite
 * `https://` o rutas same-origin, así que un puerto muerto de 127.0.0.1 ni
 * siquiera llegaría al fetch — lo clasifica 'malformed' antes de intentarlo).
 */
const DEAD_TSA_URL = '/api/tsa-muerta-e2e';

/**
 * Tolerancia (pt) al comparar rects en coordenadas de viewport — absorbe el
 * redondeo flotante de la transformación de pdf.js, nada más.
 */
const PLACEMENT_EPSILON_PT = 0.5;

/**
 * Margen (pt) que la colocación automática deja entre el sello y el borde
 * inferior del área VISIBLE, tal como se muestra. Espejo de `EDGE_MARGIN` en
 * `packages/signer/src/autoPlacement.ts`, duplicado A PROPÓSITO: importar la
 * constante del código bajo prueba haría la afirmación tautológica (cambiar
 * el valor en producción movería el sello y el test seguiría verde sin que
 * nadie se enterase).
 */
const EXPECTED_BOTTOM_INSET_PT = 18;

/** Tolerancia (pt) al comparar el margen inferior/centrado del sello. */
const INSET_TOLERANCE_PT = 1;

// ── Fixtures del lote (deterministas, generados en memoria) ─────────────────

interface LoteDoc {
  name: string;
  marker: string;
  pdf: Uint8Array;
}

function buildHeterogeneousDocs(): LoteDoc[] {
  return [
    {
      name: 'plano.pdf',
      marker: 'LOTE-E2E-PLANO',
      pdf: buildMinimalPdf({ marker: 'LOTE-E2E-PLANO' }),
    },
    {
      name: 'rotado90.pdf',
      marker: 'LOTE-E2E-ROTADO',
      pdf: buildMinimalPdf({ marker: 'LOTE-E2E-ROTADO', rotate: 90 }),
    },
    {
      name: 'recortado.pdf',
      marker: 'LOTE-E2E-CROP',
      pdf: buildMinimalPdf({
        marker: 'LOTE-E2E-CROP',
        cropBox: [CROP_X0, CROP_Y0, CROP_X1, CROP_Y1],
      }),
    },
    {
      // Los dos defectos a la vez (D1 + D2): una implementación que "arregla"
      // /Rotate o /CropBox por separado, pero no su combinación, se cae aquí.
      name: 'rotado270-recortado.pdf',
      marker: 'LOTE-E2E-ROTADO-CROP',
      pdf: buildMinimalPdf({
        marker: 'LOTE-E2E-ROTADO-CROP',
        rotate: 270,
        cropBox: [CROP_X0, CROP_Y0, CROP_X1, CROP_Y1],
      }),
    },
  ];
}

// ── Colocación automática (código de PRODUCCIÓN, ejecutado en Node) ─────────
//
// `computeAutoPlacement`/`readPageGeometry` son funciones puras sin
// dependencias de runtime — correrlas en Node ejercita exactamente el mismo
// código que correría el integrador en el navegador (no hay DOM ni Worker en
// su contrato). Lo que SÍ debe cruzar el límite real — y cruza — es la firma.
// pdf-lib se resuelve desde el paquete del firmante (pnpm no lo expone a la PWA).

const signerRequire = createRequire(resolve(REPO_ROOT, 'packages/signer/package.json'));
type PdfLibDocument = Parameters<typeof readPageGeometry>[0];
const { PDFDocument } = signerRequire('pdf-lib') as {
  PDFDocument: {
    load(bytes: Uint8Array, opts?: { updateMetadata?: boolean }): Promise<PdfLibDocument>;
  };
};

interface WireVisibleSig {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * `/Rotate` de la página destino, para que la apariencia se dibuje derecha.
   * NOTA (hallazgo, reportado en el informe): `SignVisibleSigInput` en
   * sign-bus.ts NO declara este campo, pero el worker lo propaga por spread —
   * el tipo del cable está incompleto respecto a `VisibleSigInput` del signer.
   */
  rotate: 0 | 90 | 180 | 270;
}

async function computeProductionPlacement(pdf: Uint8Array): Promise<WireVisibleSig> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const geometry = readPageGeometry(doc);
  const placement = computeAutoPlacement({ geometry, existing: [] });
  if (placement.status !== 'ok') {
    throw new Error(`auto placement devolvió needs_review: ${placement.reason}`);
  }
  return {
    page: placement.page,
    x: placement.x,
    y: placement.y,
    width: placement.w,
    height: placement.h,
    rotate: placement.rotate,
  };
}

// ── Instrumentación del Worker real (se inyecta antes de cargar la app) ─────

interface LoteWorkerStats {
  sessionWorkersCreated: number;
  openSessionMessages: number;
  signNextMessages: number;
}

/**
 * Script (string a propósito: corre en el navegador, no bajo el tsconfig de
 * Node) que envuelve `window.Worker` para contar creaciones del worker de
 * sesión y mensajes `openSession`/`signNext`. Solo cuenta — no altera nada.
 */
const WORKER_STATS_INIT_SCRIPT = `
(() => {
  const stats = { sessionWorkersCreated: 0, openSessionMessages: 0, signNextMessages: 0 };
  Object.defineProperty(window, '__loteWorkerStats', { value: stats });
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(url, options) {
      super(url, options);
      if (options && options.name === 'sign-session-worker') {
        stats.sessionWorkersCreated += 1;
        const nativePost = this.postMessage.bind(this);
        this.postMessage = (msg, ...rest) => {
          if (msg && typeof msg === 'object') {
            if (msg.kind === 'openSession') stats.openSessionMessages += 1;
            if (msg.kind === 'signNext') stats.signNextMessages += 1;
          }
          return nativePost(msg, ...rest);
        };
      }
    }
  };
})();
`;

// ── Utilidades ──────────────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/** Aserciones de colocación: sello único, dentro del área mostrada, en el pie exacto. */
async function assertSealDisplayedInFooter(signed: Uint8Array, label: string): Promise<void> {
  const placement = await readDisplayedSealPlacement(signed);
  expect(placement.seals, `${label}: debe haber exactamente 1 sello visible`).toHaveLength(1);
  const seal = placement.seals[0]!;
  const { viewportWidth: w, viewportHeight: h } = placement;
  // Dentro del área visible tal como se muestra (criterio 4b).
  expect(seal.x0, `${label}: sello sale por la izquierda`).toBeGreaterThanOrEqual(
    -PLACEMENT_EPSILON_PT,
  );
  expect(seal.y0, `${label}: sello sale por arriba`).toBeGreaterThanOrEqual(-PLACEMENT_EPSILON_PT);
  expect(seal.x1, `${label}: sello sale por la derecha`).toBeLessThanOrEqual(
    w + PLACEMENT_EPSILON_PT,
  );
  expect(seal.y1, `${label}: sello sale por abajo`).toBeLessThanOrEqual(h + PLACEMENT_EPSILON_PT);
  // No-degenerado: un widget 0×0 (firma invisible) no cuenta como sello visible.
  expect(seal.x1 - seal.x0, `${label}: sello sin ancho`).toBeGreaterThan(1);
  expect(seal.y1 - seal.y0, `${label}: sello sin alto`).toBeGreaterThan(1);

  // Insets del sello a los 4 bordes de la página TAL COMO SE MUESTRA (viewport
  // ya con /Rotate y /CropBox aplicados por pdf.js). Reemplaza la banda
  // holgada anterior por la posición EXACTA que produce `computeAutoPlacement`
  // — esto es lo que caza el defecto de la rotación: un sello "dentro de la
  // vista" pero pegado a un lado (bug histórico D1), que una banda ancha no
  // distingue pero un margen exacto sí.
  const insets = {
    left: seal.x0,
    right: w - seal.x1,
    top: seal.y0,
    bottom: h - seal.y1,
  };
  const detail = `${label} (viewport=${w}×${h}, sello=${JSON.stringify(seal)})`;
  // Margen inferior EXACTO (EDGE_MARGIN del producto, duplicado a propósito
  // — ver el comentario de EXPECTED_BOTTOM_INSET_PT).
  expect(
    Math.abs(insets.bottom - EXPECTED_BOTTOM_INSET_PT),
    `${detail}: pie de página, esperado ${EXPECTED_BOTTOM_INSET_PT}pt, obtenido ${insets.bottom}pt`,
  ).toBeLessThanOrEqual(INSET_TOLERANCE_PT);
  // Centrado horizontal (mismo criterio que el flujo interactivo).
  expect(
    Math.abs(insets.left - insets.right),
    `${detail}: centrado horizontal`,
  ).toBeLessThanOrEqual(2 * INSET_TOLERANCE_PT);
}

function assertCryptoValid(signed: Uint8Array, label: string): PadesVerifyReport {
  const report = verifyPadesIndependently(signed);
  expect(report.byteRangeCoversDocument, `${label}: ByteRange no cubre el documento`).toBe(true);
  expect(report.digestMatches, `${label}: message-digest no coincide (${report.failure})`).toBe(
    true,
  );
  expect(report.signatureValid, `${label}: la firma RSA no verifica (${report.failure})`).toBe(
    true,
  );
  // CN exacto del certificado del fixture (el `.p12` efímero de global-setup.ts),
  // no solo "hay algo" — así el test cazaría un CMS que embebe el certificado
  // equivocado, no solo uno vacío.
  expect(report.signerCN, `${label}: CN del firmante`).toBe(EXPECTED_SIGNER_CN);
  expect(report.signerSerialHex, `${label}: serial del firmante`).toBeTruthy();
  return report;
}

// ── Suite ───────────────────────────────────────────────────────────────────

test.describe('firmar.ec — lote E2E real (worker auténtico, verificación independiente)', () => {
  // Presupuesto holgado: 2 lotes reales con RSA-2048 en un runner frío puede
  // superar los 60s por defecto; sin sleeps — todo es espera por condición.
  test.setTimeout(120_000);

  // Inicializados aquí (no solo en beforeEach): cuando test.skip() aborta el
  // hook a mitad de camino (proyecto `mobile`), afterEach igual se ejecuta y
  // no debe reventar por leer un valor todavía sin asignar.
  let requestedUrls: string[] = [];
  let allowedHosts: Set<string> = new Set();

  test.beforeEach(async ({ page }, testInfo) => {
    // El spec no toca UI (conduce la API del lote directo en el navegador vía
    // page.evaluate) — correrlo también en el proyecto `mobile` (Pixel 7)
    // duplicaría exactamente la misma corrida sin cubrir nada nuevo.
    test.skip(
      testInfo.project.name !== 'chromium',
      'API del lote, no UI — un solo proyecto basta (ver playwright.config.ts)',
    );

    // Derivado del baseURL del proyecto (Art. 2 anti-hardcoding) — no un
    // literal 'localhost:5173' que se desincroniza en silencio si el puerto
    // del dev server cambia en playwright.config.ts.
    const baseURL = testInfo.project.use.baseURL;
    if (!baseURL) throw new Error('El proyecto de Playwright no define baseURL');
    allowedHosts = new Set([new URL(baseURL).host]);

    requestedUrls = [];
    page.on('request', (req) => {
      requestedUrls.push(req.url());
    });
    await page.addInitScript(WORKER_STATS_INIT_SCRIPT);
    await page.goto('/#/');
  });

  test.afterEach(() => {
    // Local de verdad (criterio 5): ninguna petición salió del entorno local.
    const offenders = requestedUrls.filter((u) => {
      if (!/^https?:/.test(u)) return false; // data:, blob:, chrome-extension:
      const { host } = new URL(u);
      return !allowedHosts.has(host);
    });
    expect(offenders, `peticiones fuera del entorno local: ${offenders.join(', ')}`).toEqual([]);
  });

  test('lote heterogéneo: 4 PDFs (plano, /Rotate 90, CropBox<MediaBox, /Rotate 270+CropBox), 1 sesión, 1 PIN', async ({
    page,
  }, testInfo) => {
    const docs = buildHeterogeneousDocs();
    const wireDocs = await Promise.all(
      docs.map(async (d) => ({
        name: d.name,
        pdfB64: toBase64(d.pdf),
        visibleSig: await computeProductionPlacement(d.pdf),
      })),
    );
    const p12B64 = toBase64(readFileSync(FIXTURE_P12));

    const run = await page.evaluate(
      async (arg) => {
        const bus = (await import(arg.busUrl)) as SessionBusModule;
        const fromB64 = (b64: string): ArrayBuffer =>
          Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;

        const session = await bus.openSignSession(fromB64(arg.p12B64), arg.pin);
        const out: Array<{
          name: string;
          signed: number[];
          timestampOk: boolean;
          timestampReason?: string;
        }> = [];
        for (const d of arg.docs) {
          const res = await session.signNext(fromB64(d.pdfB64), {
            // Producto: firma visible con colocación automática por documento.
            visibleSig: d.visibleSig as unknown as Parameters<
              typeof session.signNext
            >[1]['visibleSig'],
            // B-B a propósito: cero red en los documentos limpios (E2E local).
            timestampEnabled: false,
            ltvEnabled: false,
          });
          out.push({
            name: d.name,
            signed: Array.from(res.signedPdf),
            timestampOk: res.timestamp.ok,
            ...(res.timestamp.ok ? {} : { timestampReason: res.timestamp.reason }),
          });
        }
        const wipe = await session.closeAndWipe();
        const stats = (window as unknown as { __loteWorkerStats: LoteWorkerStats })
          .__loteWorkerStats;
        return { out, wipe, stats };
      },
      { busUrl: SESSION_BUS_URL, p12B64, pin: FIXTURE_PIN, docs: wireDocs },
    );

    // Un lote, una sesión (criterio 2): 1 worker real, 1 openSession (la única
    // ruta donde parsePfx importa la clave), N=4 signNext reutilizándola.
    expect(run.stats.sessionWorkersCreated).toBe(1);
    expect(run.stats.openSessionMessages).toBe(1);
    expect(run.stats.signNextMessages).toBe(docs.length);
    // El material de clave retenido se borró y el worker lo confirmó.
    expect(run.wipe).toEqual({ acked: true, wiped: true });

    expect(run.out).toHaveLength(docs.length);
    const signerSerials = new Set<string>();
    for (const [i, item] of run.out.entries()) {
      const signed = Uint8Array.from(item.signed);
      const label = item.name;
      // Trazabilidad entrada↔salida (orden de la cola preservado).
      expect(item.name).toBe(docs[i]!.name);
      expect(Buffer.from(signed).toString('latin1')).toContain(docs[i]!.marker);
      // Sin timestamp PORQUE se pidió así: apagado por el usuario, no degradado.
      expect(item.timestampOk).toBe(false);
      expect(item.timestampReason).toBe('user_disabled');
      // Verificación independiente (criterio 4a): cripto + cobertura.
      const report = assertCryptoValid(signed, label);
      signerSerials.add(report.signerSerialHex!);
      // Verificación independiente (criterio 4b): sello dentro del área
      // mostrada y en el pie exacto, con /Rotate y /CropBox aplicados por
      // pdf.js — incluido el documento que combina ambos defectos a la vez.
      await assertSealDisplayedInFooter(signed, label);
      // Evidencia inspeccionable de la corrida (test-results/, fuera del árbol).
      await testInfo.attach(`signed-${label}`, {
        body: Buffer.from(signed),
        contentType: 'application/pdf',
      });
    }

    // Una sesión, una clave (criterio 2, verificado desde AFUERA): las 4
    // salidas del lote llevan el certificado del MISMO firmante.
    expect(signerSerials.size, 'todas las salidas del lote usan el mismo certificado').toBe(1);

    // Controles negativos: el verificador independiente DEBE poder fallar.
    // (a) Un byte del contenido cubierto cambia → message-digest no coincide.
    const signedPlain = Uint8Array.from(run.out[0]!.signed);
    const tamperedContent = signedPlain.slice();
    const markerOffset = Buffer.from(tamperedContent).indexOf(docs[0]!.marker, 0, 'latin1');
    expect(markerOffset).toBeGreaterThan(0);
    tamperedContent[markerOffset]! ^= 0xff;
    const contentReport = verifyPadesIndependently(tamperedContent);
    expect(contentReport.digestMatches).toBe(false);
    // (b) Un byte del CMS embebido cambia → la firma deja de verificar. El
    // hueco hex de la firma es exactamente [len1, start2) del ByteRange final
    // — no se adivina el offset (el `/Contents 5 0 R` de la página engaña).
    const tamperedSig = signedPlain.slice();
    const byteRange = findFinalByteRange(tamperedSig);
    expect(byteRange).not.toBeNull();
    // +2: segundo carácter hex del DER (dentro de la cabecera SignedData,
    // nunca en el padding de ceros del final del hueco reservado).
    const hexCharOffset = byteRange![1] + 2;
    tamperedSig[hexCharOffset] = tamperedSig[hexCharOffset] === 0x30 ? 0x31 : 0x30;
    const sigReport = verifyPadesIndependently(tamperedSig);
    expect(sigReport.signatureValid).toBe(false);
  });

  test('runBatchSign: lote limpio vs lote con TSA caída — la degradación se REPORTA', async ({
    page,
  }) => {
    const cleanDocs: LoteDoc[] = [
      {
        name: 'limpio-1.pdf',
        marker: 'LOTE-E2E-LIMPIO-1',
        pdf: buildMinimalPdf({ marker: 'LOTE-E2E-LIMPIO-1' }),
      },
      {
        name: 'limpio-2.pdf',
        marker: 'LOTE-E2E-LIMPIO-2',
        pdf: buildMinimalPdf({ marker: 'LOTE-E2E-LIMPIO-2' }),
      },
    ];
    const degradedDocs: LoteDoc[] = [
      {
        name: 'ts-1.pdf',
        marker: 'LOTE-E2E-TS-1',
        pdf: buildMinimalPdf({ marker: 'LOTE-E2E-TS-1' }),
      },
      {
        name: 'ts-2.pdf',
        marker: 'LOTE-E2E-TS-2',
        pdf: buildMinimalPdf({ marker: 'LOTE-E2E-TS-2' }),
      },
      {
        name: 'ts-3.pdf',
        marker: 'LOTE-E2E-TS-3',
        pdf: buildMinimalPdf({ marker: 'LOTE-E2E-TS-3' }),
      },
    ];
    // Documentos uniformes a propósito: `BatchSignOptions.visibleSig` es único
    // para todo el lote (limitación de la API — ver informe), así que la
    // heterogeneidad geométrica se ejercita en el test de sesión de arriba.
    const visibleSig = await computeProductionPlacement(cleanDocs[0]!.pdf);
    const p12B64 = toBase64(readFileSync(FIXTURE_P12));

    const run = await page.evaluate(
      async (arg) => {
        const queue = (await import(arg.queueUrl)) as SignQueueModule;
        const fromB64 = (b64: string): ArrayBuffer =>
          Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
        const toFiles = (docs: Array<{ name: string; pdfB64: string }>): File[] =>
          docs.map((d) => new File([fromB64(d.pdfB64)], d.name, { type: 'application/pdf' }));

        const statsOf = (): LoteWorkerStats => ({
          ...(window as unknown as { __loteWorkerStats: LoteWorkerStats }).__loteWorkerStats,
        });
        const summarize = (
          r: Awaited<ReturnType<typeof queue.runBatchSign>>,
          delivered: Array<{ name: string; signed: number[] }>,
        ) => ({
          succeeded: r.succeeded,
          failed: r.failed,
          succeededDegraded: r.succeededDegraded,
          items: r.items.map((i) => ({
            name: i.file.name,
            status: i.status,
            outcome: i.outcome
              ? {
                  degraded: i.outcome.degraded,
                  timestampOk: i.outcome.timestampOk,
                  timestampReason: i.outcome.timestampReason,
                  ltvProfile: i.outcome.ltvProfile,
                }
              : undefined,
          })),
          delivered,
        });

        // Lote 1 — limpio: sin timestamp ni LTV pedidos ⇒ 0 degradados.
        const deliveredClean: Array<{ name: string; signed: number[] }> = [];
        const clean = await queue.runBatchSign(
          toFiles(arg.cleanDocs),
          fromB64(arg.p12B64),
          arg.pin,
          {
            visibleSig: arg.visibleSig as unknown as {
              page: number;
              x: number;
              y: number;
              width: number;
              height: number;
            },
            timestampEnabled: false,
            ltvEnabled: false,
            onItemSigned: (item) => {
              deliveredClean.push({
                name: item.file.name,
                signed: Array.from(item.result.signedPdf),
              });
            },
          },
        );
        const statsAfterClean = statsOf();

        // Lote 2 — TSA pedida pero muerta ⇒ firmado igual, PERO degradado.
        const deliveredDegraded: Array<{ name: string; signed: number[] }> = [];
        const degraded = await queue.runBatchSign(
          toFiles(arg.degradedDocs),
          fromB64(arg.p12B64),
          arg.pin,
          {
            visibleSig: arg.visibleSig as unknown as {
              page: number;
              x: number;
              y: number;
              width: number;
              height: number;
            },
            timestampEnabled: true,
            tsaUrl: arg.deadTsaUrl,
            // 1 intento: los backoffs de reintento (2s/6s) no aportan nada
            // contra un puerto bloqueado y solo harían lento el test.
            tsaMaxAttempts: 1,
            ltvEnabled: false,
            onItemSigned: (item) => {
              deliveredDegraded.push({
                name: item.file.name,
                signed: Array.from(item.result.signedPdf),
              });
            },
          },
        );
        const statsAfterDegraded = statsOf();

        return {
          clean: summarize(clean, deliveredClean),
          degraded: summarize(degraded, deliveredDegraded),
          statsAfterClean,
          statsAfterDegraded,
        };
      },
      {
        queueUrl: SIGN_QUEUE_URL,
        p12B64,
        pin: FIXTURE_PIN,
        visibleSig,
        deadTsaUrl: DEAD_TSA_URL,
        cleanDocs: cleanDocs.map((d) => ({ name: d.name, pdfB64: toBase64(d.pdf) })),
        degradedDocs: degradedDocs.map((d) => ({ name: d.name, pdfB64: toBase64(d.pdf) })),
      },
    );

    // Cada lote abre EXACTAMENTE una sesión (1 worker, 1 openSession) y firma
    // todos sus documentos por `signNext` en esa misma sesión.
    expect(run.statsAfterClean).toEqual({
      sessionWorkersCreated: 1,
      openSessionMessages: 1,
      signNextMessages: cleanDocs.length,
    });
    expect(run.statsAfterDegraded).toEqual({
      sessionWorkersCreated: 2,
      openSessionMessages: 2,
      signNextMessages: cleanDocs.length + degradedDocs.length,
    });

    // Lote limpio: éxito SIN degradación (lo pedido == lo conseguido).
    expect(run.clean.succeeded).toBe(cleanDocs.length);
    expect(run.clean.failed).toBe(0);
    expect(run.clean.succeededDegraded).toBe(0);
    for (const item of run.clean.items) {
      expect(item.status).toBe('done');
      expect(item.outcome?.degraded).toBe(false);
    }

    // Lote con TSA muerta (criterio 6): firmado, pero REPORTADO degradado —
    // jamás disfrazado de éxito limpio.
    expect(run.degraded.succeeded).toBe(degradedDocs.length);
    expect(run.degraded.failed).toBe(0);
    expect(run.degraded.succeededDegraded).toBe(degradedDocs.length);
    for (const item of run.degraded.items) {
      expect(item.status).toBe('done');
      expect(item.outcome?.degraded).toBe(true);
      expect(item.outcome?.timestampOk).toBe(false);
      // La causa viene nombrada (red/timeout), no en blanco.
      expect(['network', 'timeout']).toContain(item.outcome?.timestampReason);
      expect(item.outcome?.ltvProfile).toBe('B-B');
    }

    // Entrega en orden de entrada (streaming onItemSigned) y salidas VÁLIDAS
    // por verificación independiente — degradado ≠ inválido.
    expect(run.clean.delivered.map((d) => d.name)).toEqual(cleanDocs.map((d) => d.name));
    expect(run.degraded.delivered.map((d) => d.name)).toEqual(degradedDocs.map((d) => d.name));
    for (const [i, d] of [...run.clean.delivered, ...run.degraded.delivered].entries()) {
      const signed = Uint8Array.from(d.signed);
      const source = [...cleanDocs, ...degradedDocs][i]!;
      expect(Buffer.from(signed).toString('latin1')).toContain(source.marker);
      assertCryptoValid(signed, d.name);
      await assertSealDisplayedInFooter(signed, d.name);
    }
  });
});
