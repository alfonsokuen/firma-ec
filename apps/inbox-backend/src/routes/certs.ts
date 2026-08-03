/**
 * Módulo `certs` (F9.0b) — fachada del API ArgosData/Signare para emitir/revender
 * certificados de firma electrónica desde firmar.ec.
 *
 * AISLADO A PROPÓSITO: recibe el `SignareClient` por opciones (default
 * `FakeSignareClient`), no usa prisma/redis/r2 todavía y NO está montado en
 * server.ts. Se monta cuando se decida activarlo (tras flag + auth M2M de Montran).
 *
 * Rutas (públicas, prefijo /api/certificados):
 *   GET  /api/certificados/planes
 *   POST /api/certificados/solicitudes
 *   GET  /api/certificados/solicitudes
 *   GET  /api/certificados/solicitudes/:certCode
 *
 * Ver: docs/superpowers/specs/2026-05-26-firma-ec-F9-emision-certificados-argosdata-design.md
 */
import {
  ASOCIADO_PRICING_PLANS,
  type CreateCertRequestInput,
  FakeSignareClient,
  type PricingPlan,
  type SignareClient,
  netMargin,
} from '@firma-ec/signare-client';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { CertOrderService, pvpAsociadoFor } from '../services/cert-orders.js';
import { FakePayphoneClient, type PayphoneClient } from '../services/payphone.js';

/** Regex tomados del schema real `config/certificate-request` (defense in depth). */
const CEDULA = /^[0-9]{10}$/;
const DACTILAR = /^[A-Z0-9]{6,10}$/;
const RUC = /^[0-9]{13}$/;
const PHONE = /^[0-9]{10}$/;
const NAME = /^[a-zA-ZÀ-ſ_ ]+$/;

const NaturalPropsSchema = z.object({
  idType: z.literal('citizen'),
  idNumber: z.string().regex(CEDULA, 'cédula = 10 dígitos'),
  fingerPrintId: z.string().regex(DACTILAR, 'código dactilar inválido'),
  idRuc: z.string().regex(RUC).optional(),
  names: z.string().regex(NAME).max(50),
  surNames: z.string().regex(NAME).max(50),
  country: z.string().min(1),
  province: z.string().max(150),
  city: z.string().max(150),
  homeAddress: z.string().min(1).max(150),
  phoneExtension: z.string().min(1),
  phoneNumber: z.string().regex(PHONE, 'teléfono = 10 dígitos'),
  requestorEmail: z.string().email(),
});

const FileSchema = z.object({
  name: z.enum(['citizenDoc', 'lifeTest', 'photo', 'docMercantileRegistry', 'authLetter']),
  contentType: z.enum(['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']),
  /** base64; ≤5MB decodificado */
  contentB64: z.string().min(1),
  fileName: z.string().optional(),
});

const CreateBodySchema = z.object({
  personNature: z.literal('natural'), // legalRepresentative en F9.5
  pricingPlanId: z.number().int().positive(),
  email: z.string().email(),
  properties: NaturalPropsSchema,
  files: z.array(FileSchema).min(1),
  acceptedWill: z.literal(true),
  acceptedContract: z.literal(true),
  /** modo privacidad: keypair en el cliente, se envía solo el CSR */
  csrContent: z.string().optional(),
  couponCode: z.string().optional(),
  idempotencyKey: z.string().min(8).optional(),
});

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export interface CertsRoutesOpts {
  /** Cliente Signare. Default: FakeSignareClient (sin red, sin costo). */
  signare?: SignareClient;
  /** Tier mayorista. Default "Asociado". */
  acronym?: string;
  /**
   * PVP: dado el plan de COSTO, devuelve el precio al público (string).
   * Default = vender al precio "Asociado" (match por periodo+duración).
   * El PVP DEBE ser uniforme por método de pago (Art.50 LODC).
   */
  pvp?: (plan: PricingPlan) => string;
  /** Pasarela de pago. Default: FakePayphoneClient (sin red). */
  payphone?: PayphoneClient;
}

/** PVP por defecto = precio Asociado para ese periodo/duración. */
function pvpAsociado(plan: PricingPlan): string {
  const a = ASOCIADO_PRICING_PLANS.find(
    (p) => p.periodType === plan.periodType && p.duration === plan.duration,
  );
  return a?.total ?? plan.total;
}

export default async function certsRoutes(
  app: FastifyInstance,
  opts: CertsRoutesOpts = {},
): Promise<void> {
  const signare = opts.signare ?? new FakeSignareClient();
  const acronym = opts.acronym ?? 'Asociado';
  const pvp = opts.pvp ?? pvpAsociado;
  const payphone = opts.payphone ?? new FakePayphoneClient();
  const orders = new CertOrderService(signare, payphone);

  /** Valida + decodifica el body de creación. Devuelve el input o null (ya respondió 400). */
  function buildCertInput(body: unknown, reply: FastifyReply): CreateCertRequestInput | null {
    const parsed = CreateBodySchema.safeParse(body);
    if (!parsed.success) {
      reply.code(400).send({ error: 'validation', issues: parsed.error.issues });
      return null;
    }
    const b = parsed.data;
    const files = [];
    for (const f of b.files) {
      const buf = Buffer.from(f.contentB64, 'base64');
      if (buf.byteLength === 0 || buf.byteLength > MAX_FILE_BYTES) {
        reply.code(400).send({ error: 'file_size', file: f.name, max: MAX_FILE_BYTES });
        return null;
      }
      files.push({
        name: f.name,
        contentType: f.contentType,
        content: new Uint8Array(buf),
        ...(f.fileName ? { fileName: f.fileName } : {}),
      });
    }
    return {
      personNature: 'natural',
      pricingPlanId: b.pricingPlanId,
      email: b.email,
      properties: b.properties,
      files,
      acceptedWill: b.acceptedWill,
      acceptedContract: b.acceptedContract,
      faceLiveness: false,
      ...(b.csrContent ? { csrContent: b.csrContent } : {}),
      ...(b.couponCode ? { couponCode: b.couponCode } : {}),
      ...(b.idempotencyKey ? { idempotencyKey: b.idempotencyKey } : {}),
    };
  }

  // GET /api/certificados/planes
  //   público (default): SOLO datos de cara al cliente (PVP). NO filtra costo/margen.
  //   ?view=operator: incluye costoMayorista + margen (uso interno; en prod gatear con auth).
  app.get<{ Querystring: { personNature?: string; view?: string } }>(
    '/api/certificados/planes',
    async (req, reply) => {
      const personNature = req.query.personNature ?? 'natural';
      const operatorView = req.query.view === 'operator';
      const plans = await signare.listPricingPlans(personNature, acronym);
      reply.header('cache-control', operatorView ? 'no-store' : 'public, max-age=300');
      return plans.map((p) => {
        const pvpStr = pvp(p);
        const base = {
          id: p.id,
          titulo: p.title,
          periodo: p.periodType,
          duracion: p.duration,
          pvp: pvpStr,
          moneda: 'USD',
        };
        if (!operatorView) return base;
        return {
          ...base,
          costoMayorista: p.total,
          // margen neto: venta − IVA − PayPhone − costo + IVA costo (crédito)
          margen: netMargin(Number(pvpStr), Number(p.total)).toFixed(2),
        };
      });
    },
  );

  // POST /api/certificados/solicitudes — emisión directa (sin pago; admin/test).
  app.post('/api/certificados/solicitudes', async (req, reply) => {
    const input = buildCertInput(req.body, reply);
    if (!input) return reply;
    const res = await signare.createCertificateRequest(input);
    return reply.code(201).send({
      certCode: res.certCode,
      estado: res.status,
      requierePago: res.needPayment,
      urlPago: res.paymentUrl,
    });
  });

  // POST /api/certificados/checkout — flujo consumidor: cobra primero (PayPhone).
  app.post('/api/certificados/checkout', async (req, reply) => {
    const input = buildCertInput(req.body, reply);
    if (!input) return reply;
    // Resolver PVP Asociado a partir del plan de costo.
    const plans = await signare.listPricingPlans('natural', acronym);
    const plan = plans.find((p) => p.id === input.pricingPlanId);
    if (!plan) return reply.code(400).send({ error: 'plan_not_found', id: input.pricingPlanId });
    const pvpValue = pvpAsociadoFor(plan.periodType, plan.duration);
    if (!pvpValue) return reply.code(400).send({ error: 'no_pvp_for_plan' });

    const { orderId, paymentUrl } = await orders.createCheckout({ cert: input }, pvpValue);
    return reply.code(201).send({ orderId, urlPago: paymentUrl, pvp: pvpValue });
  });

  // POST /api/certificados/checkout/:orderId/confirm — confirma pago → crea solicitud.
  app.post<{ Params: { orderId: string } }>(
    '/api/certificados/checkout/:orderId/confirm',
    async (req, reply) => {
      try {
        const order = await orders.confirmPayment(req.params.orderId);
        return reply.code(200).send(order);
      } catch {
        return reply.code(404).send({ error: 'order_not_found', orderId: req.params.orderId });
      }
    },
  );

  // GET /api/certificados/checkout/:orderId
  app.get<{ Params: { orderId: string } }>(
    '/api/certificados/checkout/:orderId',
    async (req, reply) => {
      const order = await orders.get(req.params.orderId);
      if (!order) return reply.code(404).send({ error: 'order_not_found' });
      return order;
    },
  );

  // GET /api/certificados/solicitudes
  app.get<{ Querystring: { page?: string; size?: string } }>(
    '/api/certificados/solicitudes',
    async (req) => {
      const page = Number(req.query.page ?? '0');
      const size = Number(req.query.size ?? '12');
      return signare.listCertificateRequests(
        Number.isFinite(page) ? page : 0,
        Number.isFinite(size) ? size : 12,
      );
    },
  );

  // GET /api/certificados/solicitudes/:certCode
  app.get<{ Params: { certCode: string } }>(
    '/api/certificados/solicitudes/:certCode',
    async (req, reply) => {
      try {
        return await signare.getCertificateRequest(req.params.certCode);
      } catch {
        return reply.code(404).send({ error: 'not_found', certCode: req.params.certCode });
      }
    },
  );
}
