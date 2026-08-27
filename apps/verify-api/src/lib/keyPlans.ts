/**
 * Los dos planes con los que se emite una clave.
 *
 * La API alojada es un servicio de pago: consume CPU, ancho de banda y atencion
 * operativa de IDK Manager. Lo gratuito es el SOFTWARE — AGPL, corriendo en la
 * infraestructura de quien lo use (ver LICENSE-COMMERCIAL.md). Por eso aqui no
 * hay un plan "comunidad" permanente: hay una PRUEBA que caduca sola y un plan
 * de pago que declara su volumen.
 *
 * Una prueba que no caduca es un plan gratuito con otro nombre. La caducidad la
 * aplica `isUsable()` en keyStore.ts contra `expiresAt`, que vive en el registro
 * persistente — no en los contadores en memoria. Esa distincion importa: un tope
 * de "N verificaciones en total" NO seria exigible hoy, porque los contadores se
 * reinician en cada redespliegue. La fecha si.
 */

/** Duracion por defecto de una prueba, en dias. */
export const TRIAL_DAYS = 30;

/**
 * Ritmo de la prueba. Alcanza para evaluar la API y construir una integracion
 * contra ella; una carga real lo agota el primer dia, que es el proposito.
 */
export const TRIAL_QUOTA = {
  quotaPerMinute: 3,
  quotaPerDay: 50,
  maxConcurrent: 1,
} as const;

/**
 * Techo de concurrencia del servicio. El contenedor corre dos worker threads,
 * asi que `maxConcurrent: 2` es TODO el motor: una sola clave con ese valor
 * puede dejar sin capacidad de verificacion a las demas. Subirlo no compra nada
 * mientras VERIFY_WORKERS siga en 2.
 */
export const MAX_CONCURRENT_CEILING = 2;

/** Ritmo por defecto de una clave de pago. El volumen diario NO tiene default. */
export const PAID_RATE = {
  quotaPerMinute: 30,
  maxConcurrent: MAX_CONCURRENT_CEILING,
} as const;

export interface KeyRecordInput {
  keyId: string;
  secretHash: string;
  name: string;
  /** Milisegundos desde epoch. Se inyecta para poder probar la caducidad. */
  now: number;
}

export interface TrialPlan {
  kind: 'trial';
  /** Dias de vigencia. */
  days: number;
}

export interface PaidPlan {
  kind: 'paid';
  /** Volumen diario contratado. Obligatorio: no hay valor por defecto a proposito. */
  quotaPerDay: number;
}

export type KeyPlan = TrialPlan | PaidPlan;

export interface MintedKeyRecord {
  keyId: string;
  secretHash: string;
  name: string;
  status: 'active';
  expiresAt?: string;
  quotaPerMinute: number;
  quotaPerDay: number;
  maxConcurrent: number;
}

/**
 * Construye el registro que se anade al fichero de claves.
 *
 * Separado del CLI para poder probarlo: la logica que decide si una clave
 * caduca no debe vivir en un script que solo se ejerce a mano en produccion.
 */
export function buildKeyRecord(input: KeyRecordInput, plan: KeyPlan): MintedKeyRecord {
  const base = {
    keyId: input.keyId,
    secretHash: input.secretHash,
    name: input.name,
    status: 'active' as const,
  };

  if (plan.kind === 'trial') {
    if (!Number.isInteger(plan.days) || plan.days <= 0) {
      throw new Error(`trial length must be a positive whole number of days, got ${plan.days}`);
    }
    return {
      ...base,
      expiresAt: new Date(input.now + plan.days * 86_400_000).toISOString(),
      ...TRIAL_QUOTA,
    };
  }

  if (!Number.isInteger(plan.quotaPerDay) || plan.quotaPerDay <= 0) {
    throw new Error(
      `a paid key must declare its daily volume as a positive whole number, got ${plan.quotaPerDay}`,
    );
  }

  // Sin `expiresAt`: la vigencia de una clave de pago la manda el contrato, no
  // el acunador. Se revoca poniendo "status": "revoked" en su registro.
  return {
    ...base,
    quotaPerMinute: PAID_RATE.quotaPerMinute,
    quotaPerDay: plan.quotaPerDay,
    maxConcurrent: PAID_RATE.maxConcurrent,
  };
}
