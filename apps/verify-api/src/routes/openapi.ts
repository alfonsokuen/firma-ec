/**
 * GET /v1/openapi.json — the machine-readable contract.
 *
 * Public, no key required: a client cannot decide whether to integrate if they
 * must first ask us for credentials to read the docs.
 *
 * Written as an object rather than a YAML file on disk so it ships inside the
 * bundle. The runtime image carries no files beyond the bundle itself, and a
 * spec that has to be copied separately is a spec that eventually is not.
 *
 * The response codes documented here are the ones the service really returns,
 * including the distinction that matters most: 422 means WE could not parse the
 * caller's document, 502 means OUR engine failed. Collapsing those two into a
 * verdict is the failure mode this API is built to avoid.
 */
import { ENGINE_VERSION } from '@firma-ec/verifier';
import type { FastifyInstance } from 'fastify';
import { API_VERSION } from '../version.js';

export default async function openapiRoutes(app: FastifyInstance): Promise<void> {
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'firmar.ec — API de verificación de firmas',
      // Inyectada en build desde package.json (ver src/version.ts). NO se
      // escribe a mano: hacerlo ya produjo una imagen que mentia sobre si misma.
      version: API_VERSION,
      description:
        'Verifica firmas electrónicas PAdES en documentos PDF contra las anclas de ' +
        'confianza de las entidades de certificación acreditadas del Ecuador.\n\n' +
        'Esta API **nunca recibe claves privadas**: verificar sólo necesita el material ' +
        'público que ya viaja dentro del documento.\n\n' +
        'Esta API alojada es un **servicio de pago**. El software es libre bajo ' +
        'AGPL-3.0: puede desplegarlo en su propia infraestructura sin costo y sin ' +
        'que sus documentos salgan de su red.\n\n' +
        '**Prueba:** 30 días, 50 verificaciones al día, 3 por minuto, 1 simultánea. ' +
        'Alcanza para evaluar la API y construir la integración; una carga real la ' +
        'agota el primer día. Al vencer, la clave deja de autenticar.\n\n' +
        '**Producción:** volumen diario según contrato. Escríbanos.\n\n' +
        'La cuota diaria se reinicia a las 00:00 **UTC** (19:00 en Ecuador continental).',
      contact: { name: 'firmar.ec', url: 'https://firmar.ec' },
    },
    servers: [{ url: 'https://api.firmar.ec', description: 'Producción' }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Clave de API en `Authorization: Bearer fev_live_...`. Se entrega una sola vez ' +
            'y no se puede recuperar; si se pierde, se emite otra y se revoca la anterior.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'string',
              description: 'Código estable, apto para programar contra él.',
            },
            message: { type: 'string', description: 'Detalle legible. Puede cambiar.' },
          },
        },
        VerificationResult: {
          type: 'object',
          properties: {
            signatureCount: { type: 'integer' },
            overallStatus: {
              type: 'string',
              enum: ['valid', 'warning', 'invalid', 'no_signature'],
              description:
                'Peor caso entre todas las firmas. `invalid` significa que el documento fue ' +
                'alterado tras firmarse, o que el firmante no encadena a una CA acreditada. ' +
                'Un documento íntegro firmado por un certificado no confiable es `invalid`: ' +
                'íntegro no es lo mismo que confiable.',
            },
            engineVersion: { type: 'string', example: ENGINE_VERSION },
            verifiedAt: { type: 'string', format: 'date-time' },
            signatures: {
              type: 'array',
              description: 'Una entrada por firma, en orden de firmado.',
              items: { type: 'object' },
            },
          },
        },
      },
    },
    paths: {
      '/v1/verify': {
        post: {
          summary: 'Verificar las firmas de un PDF',
          description:
            'El cuerpo es el PDF crudo. Envíe `Idempotency-Key` para que un reintento ' +
            'devuelva el mismo veredicto sin volver a ejecutar el trabajo ni consumir cuota.',
          parameters: [
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: false,
              schema: { type: 'string', maxLength: 200 },
              description:
                'Identificador único del intento (por ejemplo un UUID). Reutilizarlo con un ' +
                'documento distinto devuelve 409.',
            },
          ],
          requestBody: {
            required: true,
            content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
          },
          responses: {
            '200': {
              description: 'Veredicto.',
              headers: {
                'RateLimit-Remaining': { schema: { type: 'integer' } },
                'Idempotent-Replay': {
                  schema: { type: 'boolean' },
                  description: 'true si la respuesta se sirvió de un intento anterior.',
                },
              },
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/VerificationResult' } },
              },
            },
            '401': { description: 'Clave ausente, desconocida, revocada o caducada.' },
            '409': { description: 'La `Idempotency-Key` ya se usó con otro documento.' },
            '413': { description: 'Excede el tamaño máximo o el presupuesto de verificación.' },
            '422': {
              description:
                'El documento no se pudo procesar, o declara demasiadas firmas. Es un ' +
                'problema del documento enviado, no del servicio.',
            },
            '429': { description: 'Cuota agotada. Reintente después de `Retry-After`.' },
            '502': {
              description:
                'Falló nuestro motor de verificación. NO es un juicio sobre el documento: ' +
                'reintente, y si persiste, avísenos.',
            },
            '503': { description: 'Servicio ocupado. Reintente.' },
            '504': { description: 'La verificación excedió su plazo.' },
          },
        },
      },
      '/v1/engine': {
        get: {
          summary: 'Versión del motor de verificación',
          description: 'Permite reproducir un veredicto: el mismo motor da el mismo resultado.',
          responses: { '200': { description: 'ok' } },
        },
      },
      '/livez': {
        get: {
          summary: 'El proceso está vivo',
          security: [],
          responses: { '200': { description: 'ok' } },
        },
      },
      '/healthz': {
        get: {
          summary: 'El servicio puede emitir un veredicto correcto',
          description:
            'Devuelve 503 si las anclas de confianza están degradadas. Importa porque unas ' +
            'anclas incompletas marcarían como no confiables firmas legítimas, que desde ' +
            'fuera se ve igual que un documento adulterado.',
          security: [],
          responses: { '200': { description: 'ok' }, '503': { description: 'degradado' } },
        },
      },
    },
  };

  app.get('/v1/openapi.json', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return spec;
  });
}
