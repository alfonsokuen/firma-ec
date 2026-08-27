/**
 * El ARTEFACTO DESPLEGADO, ejercitado como lo ejercita un cliente.
 *
 * Por que existe: los otros 81 tests son buenos, y ninguno tocaba la
 * configuracion que corre en produccion.
 *
 *   | lo que probaban            | lo que corre en prod              |
 *   |----------------------------|-----------------------------------|
 *   | `app.inject` (en proceso)  | un socket TCP de verdad           |
 *   | `VERIFY_IN_WORKER: false`  | `true`, con 2 worker threads      |
 *   | `fixtures/test-worker.mjs` | `dist/verify-worker.js`, el real   |
 *
 * Es decir: el verificador que hace el trabajo en produccion no lo cargaba
 * NINGUN test. `worker-pool.test.ts` prueba la logica del pool contra un worker
 * de mentira que finge colgarse — correcto para eso, y ciego a si el worker
 * real arranca, resuelve sus 28 anclas de confianza y emite un veredicto.
 *
 * Este test arranca `dist/index.js` como proceso hijo y le habla por HTTP. Si el
 * bundle no compila, no arranca, no resuelve las anclas o el worker muere, aqui
 * se ve. Corre despues de `build` (ver `pretest`).
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mintApiKey } from '../src/lib/apiKey.js';
import { buildKeyRecord } from '../src/lib/keyPlans.js';
import { TEST_PEPPER } from './helpers.js';

const APP = resolve(__dirname, '..');
const BUNDLE = resolve(APP, 'dist/index.js');
const WORKER = resolve(APP, 'dist/verify-worker.js');
const FIX = resolve(__dirname, '../../../packages/verifier/tests/fixtures');

/**
 * Puerto libre pedido al SO y liberado antes de pasarselo al hijo. Con `PORT=0`
 * el hijo elegiria uno que este test no podria conocer sin parsear su log; con
 * un puerto fijo, dos corridas simultaneas (o un proceso zombi) chocan.
 */
async function freePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr === null || typeof addr === 'string') {
        rej(new Error('no pude reservar un puerto libre'));
        return;
      }
      srv.close(() => res(addr.port));
    });
  });
}

let BASE = '';

let child: ChildProcess | undefined;
let token: string;
let stderr = '';
let death = '';

/** Cada assert empieza comprobando que el servidor sigue vivo. */
function assertAlive(): void {
  if (death !== '') throw new Error(death);
}

/** Espera por CONDICION, no por un sleep arbitrario. */
async function waitForLive(deadlineMs: number): Promise<void> {
  const until = Date.now() + deadlineMs;
  let last = '';
  while (Date.now() < until) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`el servidor murio al arrancar (code ${child.exitCode}).\n${stderr}`);
    }
    try {
      const res = await fetch(`${BASE}/livez`);
      if (res.status === 200) return;
      last = `http ${res.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`el bundle no respondio /livez en ${deadlineMs}ms (ultimo: ${last})\n${stderr}`);
}

beforeAll(async () => {
  // Fallar con un mensaje util, no con un ENOENT crudo. Y NUNCA saltar el test
  // en silencio: un test que se salta solo cuando falta el artefacto es un test
  // que siempre pasa.
  for (const f of [BUNDLE, WORKER]) {
    if (!existsSync(f)) {
      throw new Error(`falta ${f}. Corre \`pnpm -F @firma-ec/verify-api build\` antes de los tests.`);
    }
  }

  const port = await freePort();
  BASE = `http://127.0.0.1:${port}`;

  const minted = mintApiKey(TEST_PEPPER, 'test');
  token = minted.token;
  const record = buildKeyRecord(
    { keyId: minted.keyId, secretHash: minted.secretHash, name: 'e2e', now: Date.now() },
    // Cuota holgada: aqui se prueba el motor, no el limitador (eso ya tiene
    // sus propios tests). Con la de prueba, 3/min, este fichero se auto-limita.
    { kind: 'paid', quotaPerDay: 1000 },
  );

  child = spawn(process.execPath, [BUNDLE], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      HOST: '127.0.0.1',
      LOG_LEVEL: 'warn',
      API_KEY_PEPPER: TEST_PEPPER,
      API_KEYS: JSON.stringify([record]),
      // El punto de todo el fichero.
      VERIFY_IN_WORKER: 'true',
      VERIFY_WORKERS: '1',
      // Sin red hacia OCSP: el test no debe depender de un tercero.
      FETCH_OCSP: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr?.on('data', (d) => {
    stderr += String(d);
  });
  child.stdout?.on('data', (d) => {
    stderr += String(d);
  });
  // Si el hijo muere a mitad, los asserts siguientes fallan con un
  // `fetch failed` opaco. Esto guarda POR QUE murio.
  child.on('exit', (code, signal) => {
    death = `el servidor hijo murio: code=${code} signal=${signal}\n${stderr}`;
  });

  // 90s, no 30: en la PRIMERA ejecucion tras un build, Windows escanea el
  // fichero recien escrito antes de dejarlo correr, y eso ya hizo fallar este
  // test una vez para pasar en 504ms a la segunda. Un test flaky se acaba
  // ignorando, que es peor que no tenerlo.
  await waitForLive(90_000);
}, 120_000);

afterAll(async () => {
  child?.kill();
});

describe('el bundle construido, por HTTP real', () => {
  test('la version que publica es la del manifiesto, no una escrita a mano', async () => {
    assertAlive();
    // REGRESION: la imagen etiquetada 0.2.0 servia `info.version: "0.1.0"`, y
    // exponia una ruta que en 0.1.0 no existia. El artefacto desplegado no
    // correspondia a ningun commit y su version mentia.
    const pkg = JSON.parse(await readFile(resolve(APP, 'package.json'), 'utf8')) as {
      version: string;
    };
    const spec = (await (await fetch(`${BASE}/v1/openapi.json`)).json()) as {
      info: { version: string };
    };
    expect(spec.info.version).toBe(pkg.version);
    expect(spec.info.version).not.toBe('dev');
  });

  test('arranca con TODAS sus anclas de confianza utilizables', async () => {
    assertAlive();
    // Unas anclas incompletas no rompen nada visible: marcan como no confiables
    // firmas legitimas, que desde fuera se ve igual que un documento adulterado.
    const res = await fetch(`${BASE}/healthz`);
    const body = (await res.json()) as { usableAnchors: number; declaredAnchors: number };
    expect(res.status).toBe(200);
    expect(body.declaredAnchors).toBeGreaterThan(0);
    expect(body.usableAnchors).toBe(body.declaredAnchors);
  });

  test('el worker REAL verifica una firma real de extremo a extremo', async () => {
    assertAlive();
    const pdf = await readFile(resolve(FIX, 'eci-real-signed.pdf'));
    const res = await fetch(`${BASE}/v1/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf', authorization: `Bearer ${token}` },
      body: pdf,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { signatureCount: number; overallStatus: string };
    // El worker hizo trabajo de verdad: encontro la firma y emitio un veredicto,
    // no devolvio un envoltorio vacio.
    expect(body.signatureCount).toBeGreaterThan(0);
    expect(['valid', 'warning', 'invalid']).toContain(body.overallStatus);
  }, 60_000);

  test('EN ROJO: un documento alterado tras firmarse sale invalid', async () => {
    assertAlive();
    // Sin esto, el test anterior pasaria igual con un worker que devolviera
    // "valid" a todo. Este es el que prueba que de verdad esta verificando.
    const pdf = await readFile(resolve(FIX, 'incremental-tampered.pdf'));
    const res = await fetch(`${BASE}/v1/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf', authorization: `Bearer ${token}` },
      body: pdf,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { overallStatus: string };
    expect(body.overallStatus).toBe('invalid');
  }, 60_000);

  test('sin clave, el socket real devuelve 401 y no procesa el cuerpo', async () => {
    assertAlive();
    const pdf = await readFile(resolve(FIX, 'eci-real-signed.pdf'));
    const res = await fetch(`${BASE}/v1/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: pdf,
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });
});
