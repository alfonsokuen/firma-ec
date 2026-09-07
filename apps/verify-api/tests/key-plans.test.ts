/**
 * Planes de emision: prueba que caduca vs clave de pago.
 *
 * La API alojada es de pago y lo unico gratuito es una PRUEBA. El riesgo real
 * de ese modelo no es cobrar de menos: es emitir por descuido una clave sin
 * fecha de fin, que entonces es un plan gratuito permanente que nadie decidio.
 * Por eso estos tests afirman las dos direcciones — la prueba caduca DE VERDAD
 * (contra el mismo `isUsable` que usa el servidor, y contra el servidor real),
 * y la de pago exige declarar su volumen.
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, test } from 'vitest';
import {
  MAX_CONCURRENT_CEILING,
  TRIAL_DAYS,
  TRIAL_QUOTA,
  buildKeyRecord,
} from '../src/lib/keyPlans.js';
import { apiKeyRecordSchema, isUsable } from '../src/lib/keyStore.js';
import { auth, buildTestServer, makeTestKey } from './helpers.js';

const stub = { keyId: 'abcdef012345', secretHash: 'deadbeef', name: 'Cliente' };
const NOW = Date.UTC(2026, 0, 1);

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('plan de prueba', () => {
  test('lleva fecha de fin: sin ella seria un plan gratuito con otro nombre', () => {
    const rec = buildKeyRecord({ ...stub, now: NOW }, { kind: 'trial', days: TRIAL_DAYS });
    expect(rec.expiresAt).toBeDefined();
    expect(new Date(rec.expiresAt as string).getTime()).toBe(NOW + TRIAL_DAYS * 86_400_000);
  });

  test('sale con la cuota restrictiva, no con la de pago', () => {
    const rec = buildKeyRecord({ ...stub, now: NOW }, { kind: 'trial', days: TRIAL_DAYS });
    expect(rec.quotaPerDay).toBe(TRIAL_QUOTA.quotaPerDay);
    expect(rec.quotaPerMinute).toBe(TRIAL_QUOTA.quotaPerMinute);
    expect(rec.maxConcurrent).toBe(TRIAL_QUOTA.maxConcurrent);
  });

  test('el registro que emite es valido para el servidor', () => {
    const rec = buildKeyRecord({ ...stub, now: NOW }, { kind: 'trial', days: TRIAL_DAYS });
    expect(apiKeyRecordSchema.safeParse(rec).success).toBe(true);
  });

  test('sirve dentro de la ventana y deja de servir al pasarla', () => {
    const rec = apiKeyRecordSchema.parse(
      buildKeyRecord({ ...stub, now: NOW }, { kind: 'trial', days: TRIAL_DAYS }),
    );
    const unDiaAntes = new Date(NOW + (TRIAL_DAYS - 1) * 86_400_000);
    const unDiaDespues = new Date(NOW + (TRIAL_DAYS + 1) * 86_400_000);
    expect(isUsable(rec, unDiaAntes)).toBe(true);
    expect(isUsable(rec, unDiaDespues)).toBe(false);
  });

  test('EN ROJO: caducada, el servidor real devuelve 401', async () => {
    // No basta con que `isUsable` diga false: lo que importa es que la peticion
    // se rechace en la ruta real, con el mismo 401 opaco que cualquier otro
    // fallo de autenticacion.
    const vencida = buildKeyRecord(
      { ...stub, now: Date.now() - 400 * 86_400_000 },
      {
        kind: 'trial',
        days: TRIAL_DAYS,
      },
    );
    const key = makeTestKey({ expiresAt: vencida.expiresAt as string });
    app = await buildTestServer(key);
    const res = await app.inject({ method: 'GET', url: '/v1/engine', headers: auth(key) });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthorized' });
  });

  test('rechaza una duracion que no es un numero entero de dias', () => {
    for (const days of [0, -5, 1.5, Number.NaN]) {
      expect(() => buildKeyRecord({ ...stub, now: NOW }, { kind: 'trial', days })).toThrow();
    }
  });
});

describe('clave de pago', () => {
  test('no caduca: su vigencia la manda el contrato', () => {
    const rec = buildKeyRecord({ ...stub, now: NOW }, { kind: 'paid', quotaPerDay: 5000 });
    expect(rec.expiresAt).toBeUndefined();
    expect(rec.quotaPerDay).toBe(5000);
  });

  test('exige declarar el volumen diario: sin default a proposito', () => {
    for (const quotaPerDay of [0, -1, 12.5, Number.NaN]) {
      expect(() => buildKeyRecord({ ...stub, now: NOW }, { kind: 'paid', quotaPerDay })).toThrow();
    }
  });

  test('no supera el techo de concurrencia del motor', () => {
    // El contenedor corre dos workers: pedir mas slots no compra nada y deja
    // sin capacidad al resto.
    const rec = buildKeyRecord({ ...stub, now: NOW }, { kind: 'paid', quotaPerDay: 100_000 });
    expect(rec.maxConcurrent).toBeLessThanOrEqual(MAX_CONCURRENT_CEILING);
  });
});
