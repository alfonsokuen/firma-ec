import type { FastifyInstance } from 'fastify';
import RedisMock from 'ioredis-mock';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildServer } from '../src/server.js';

/**
 * routes.test.ts — endpoint shape over buildServer with mocks (no DB/Redis).
 *
 * Covers the contract the landing relies on: GET /api/stats returns the four
 * worker-compatible fields (certificatesIssued always null), and a bad
 * granularity on the series endpoint is a 422.
 */

function sqlText(strings: TemplateStringsArray): string {
  return strings.join(' ').toLowerCase();
}

function mockPrisma() {
  return {
    // biome-ignore lint/suspicious/noExplicitAny: minimal prisma test double
    $queryRaw: async (strings: TemplateStringsArray, ..._args: unknown[]): Promise<any> => {
      const sql = sqlText(strings);
      if (sql.includes('select 1')) return [{ '?column?': 1 }];
      if (sql.includes('from "stats_events"') && sql.includes('min(')) return [{ m: null }];
      if (sql.includes('from "stats_events"')) return [];
      if (sql.includes('from "usage_counters"')) {
        return [
          { key: 'sign', count: 5n },
          { key: 'verify', count: 3n },
          { key: 'cert', count: 1n },
        ];
      }
      return [];
    },
    // recordEvent writes via $executeRaw — accept and report 1 affected row.
    $executeRaw: async (): Promise<number> => 1,
    $disconnect: async () => {},
    // biome-ignore lint/suspicious/noExplicitAny: cast to PrismaClient for plugin
  } as any;
}

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildServer({
    disableRateLimit: true,
    overrides: { prisma: mockPrisma(), redis: new RedisMock() as never },
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/stats — worker-compatible shape', () => {
  test('returns the four fields with certificatesIssued: null', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'certificatesIssued',
      'certificatesValidated',
      'pdfsSigned',
      'signaturesVerified',
    ]);
    expect(body).toEqual({
      pdfsSigned: 5,
      signaturesVerified: 3,
      certificatesValidated: 1,
      certificatesIssued: null,
    });
    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });
});

describe('GET /api/stats/series — validation', () => {
  test('bad granularity → 422 invalid_input', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats/series?granularity=foo' });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'invalid_input' });
  });

  test('missing granularity → 422', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats/series' });
    expect(res.statusCode).toBe(422);
  });

  test('valid granularity → 200 with the series shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats/series?granularity=day' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      granularity: string;
      since: string;
      buckets: Array<{ period: string; sign: number; verify: number; cert: number }>;
      totals: { sign: number; verify: number; cert: number };
    };
    expect(body.granularity).toBe('day');
    expect(typeof body.since).toBe('string');
    expect(body.buckets).toHaveLength(30);
    expect(body.totals).toEqual({ sign: 5, verify: 3, cert: 1 });
    expect(res.headers['cache-control']).toBe('public, max-age=300');
  });
});

describe('POST /api/stats/event — validation', () => {
  test('bad type → 422 invalid_input', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/stats/event?type=bogus' });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: string }).error).toBe('invalid_input');
  });

  test('valid type via query → 204', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/stats/event?type=sign' });
    expect(res.statusCode).toBe(204);
  });
});

/**
 * 2026-08-24 — El aviso de privacidad (§3 y §4) promete que la IP del cliente no
 * queda registrada junto al tipo de operación. Una auditoría encontró que SÍ se
 * registraba: `disableRequestLogging: false` + `trustProxy: true` hacen que el
 * serializador por defecto de Fastify escriba `remoteAddress` con la IP real en
 * la misma línea que la URL (que lleva `?type=sign`) y la marca de tiempo — es
 * decir, "quién firmó y a qué hora".
 *
 * Este test va sobre la RUTA REAL (Fastify de verdad, la ruta de verdad, el
 * serializador de verdad) y lee lo que se escribe, no la configuración.
 */
describe('privacidad — la IP del cliente no llega al log de aplicación', () => {
  const IP = '186.4.55.201';

  test('un beacon con X-Forwarded-For no deja la IP en ninguna línea de log', async () => {
    const lineas: string[] = [];
    const stream = {
      write(chunk: string) {
        lineas.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const app = await buildServer({
      disableRateLimit: true,
      logStream: stream,
      overrides: { prisma: mockPrisma(), redis: new RedisMock() as never },
    });
    try {
      await app.inject({
        method: 'POST',
        url: '/api/stats/event?type=sign',
        headers: { 'x-forwarded-for': IP },
      });
      await app.inject({ method: 'GET', url: '/api/stats' });
    } finally {
      await app.close();
    }

    const todo = lineas.join('\n');
    // Precondición: el log NO está vacío, o el test pasaría por no mirar nada.
    expect(todo.length).toBeGreaterThan(0);
    expect(todo).toContain('/api/stats/event');
    // Lo que importa.
    expect(todo).not.toContain(IP);
    expect(todo).not.toContain('remoteAddress');
    expect(todo).not.toContain('remotePort');
  });
});

/**
 * El cubo del limitador NO es por visitante. `req.ip` resuelve a una dirección
 * interna de nuestra red overlay (todo el tráfico público entra por el túnel),
 * medido contra producción el 2026-08-24: 1498/1498 peticiones con dirección
 * privada, 0 públicas. Es decir, un único cubo global de 20/hora para todo el
 * mundo. Cuando se vacía, un evento REAL deja de contarse y la cifra publicada
 * se queda corta — antes, sin dejar rastro alguno.
 *
 * Este test va sobre la RUTA REAL y afirma las dos direcciones: que el descarte
 * queda registrado, y que un evento normal NO ensucia el log con esa alarma.
 */
describe('medición — un evento descartado por el limitador deja rastro', () => {
  const MARCA = 'stats event DROPPED';

  function capturarLog() {
    const lineas: string[] = [];
    const stream = {
      write(chunk: string) {
        lineas.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WritableStream;
    return { lineas, stream };
  }

  test('cubo vacío → 204 al cliente, warning en el log y NADA escrito en la BD', async () => {
    const { lineas, stream } = capturarLog();
    let escrituras = 0;
    const prisma = mockPrisma();
    prisma.$executeRaw = async (): Promise<number> => {
      escrituras++;
      return 1;
    };
    // Cubo agotado: el Lua devolvería [0, retry_ms].
    // RedisMock real (tiene on/quit/...); solo se fuerza el veredicto del cubo.
    const redisVacio = new RedisMock();
    (redisVacio as unknown as { eval: () => Promise<unknown> }).eval = async () => [0, 3000];

    const app = await buildServer({
      disableRateLimit: true,
      logStream: stream,
      overrides: { prisma, redis: redisVacio as never },
    });
    let codigo = 0;
    try {
      const res = await app.inject({ method: 'POST', url: '/api/stats/event?type=sign' });
      codigo = res.statusCode;
    } finally {
      await app.close();
    }

    const todo = lineas.join('\n');
    // Precondición: si el log viniera vacío, el test no estaría mirando nada.
    expect(todo.length).toBeGreaterThan(0);
    // El cliente no se entera (no filtramos el estado del limitador)...
    expect(codigo).toBe(204);
    // ...pero nosotros sí, y el evento no se contó.
    expect(todo).toContain(MARCA);
    expect(escrituras).toBe(0);
  });

  test('cubo con crédito → el evento se cuenta y NO aparece la alarma', async () => {
    const { lineas, stream } = capturarLog();
    let escrituras = 0;
    const prisma = mockPrisma();
    prisma.$executeRaw = async (): Promise<number> => {
      escrituras++;
      return 1;
    };
    const redisConCredito = new RedisMock();
    (redisConCredito as unknown as { eval: () => Promise<unknown> }).eval = async () => [1, 0];

    const app = await buildServer({
      disableRateLimit: true,
      logStream: stream,
      overrides: { prisma, redis: redisConCredito as never },
    });
    try {
      await app.inject({ method: 'POST', url: '/api/stats/event?type=sign' });
    } finally {
      await app.close();
    }

    const todo = lineas.join('\n');
    expect(todo.length).toBeGreaterThan(0);
    expect(todo).not.toContain(MARCA);
    // Dos escrituras, no una: el contador Y la fila con la marca de tiempo
    // del servidor. Es el "efecto doble" que declara el aviso de privacidad.
    expect(escrituras).toBe(2);
  });
});
