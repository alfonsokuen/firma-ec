# verify-api — despliegue del piloto

API pública de verificación de firmas PAdES. Se despliega en la **misma
infraestructura que firmar.ec**: Swarm en `190.160.10.129`, detrás de Traefik,
detrás del túnel de Cloudflare. Stack dedicado `firma-ec-verify`, de modo que
desplegarlo no puede mover landing, pwa ni stats.

```
cliente → Cloudflare → cloudflared (túnel) → Traefik :443 → firma-ec-verify_verify :3000
```

## Orden de ejecución

```bash
# 1. Una sola vez: pepper (Docker secret) + fichero de claves en NFS
scripts/provision-verify-secrets.sh

# 2. Construir e instalar la imagen SIN abrir tráfico todavía
scripts/deploy-verify-api.sh            # falla si la lista de claves está vacía

# 3. Acuñar la primera clave y añadir su registro al fichero
scripts/mint-verify-key.sh "Cliente piloto"

# 4. Redeploy para que el servicio la lea
scripts/deploy-verify-api.sh
```

DNS: hace falta el registro de `api.firmar.ec` en Cloudflare y la entrada del
túnel (ya añadida en `infra/cloudflare/tunnel.yml`, hay que aplicarla en el
`cloudflared` que corre en el nodo).

## Decisiones que conviene conocer antes de tocar nada

**Una sola réplica, a propósito.** La cuota y la idempotencia viven en memoria
del proceso. Con dos réplicas el techo real sería el doble de la cuota y —peor—
la promesa del `Idempotency-Key` sería falsa la mitad de las veces: un reintento
que aterrizara en la otra réplica re-ejecutaría el trabajo y volvería a cobrar.
Antes de escalar hay que mover ambos al token-bucket de Redis que
`inbox-backend` ya tiene.

**`TRUST_PROXY=false`, que es lo contrario del consejo habitual.** Detrás de un
edge lo correcto suele ser fijar el número de saltos para que los cubos por IP
sigan funcionando. Aquí no aplica: en esta infraestructura la IP del visitante
no llega al origen (medido en la landing: 1.498 de 1.498 peticiones con
direcciones privadas) y además el producto prohíbe registrarla. El cubo que
importa se agrupa por API key; confiar en una cabecera reenviada solo añadiría
una entrada falsificable.

**El healthcheck de Traefik apunta a `/livez`, no a `/healthz`.** `/healthz` se
pone en rojo ante una degradación de las anclas de confianza —lo correcto para
que un orquestador retire la instancia— pero con una sola réplica haría que
Traefik dejara el servicio sin destino. El estado de las anclas se comprueba en
el smoke del despliegue y debe vigilarse aparte.

**Sin el middleware `firma-headers`.** Aplica CSP y `X-Frame-Options` pensados
para superficies web; en una API JSON son ruido y su CSP pisaría la del origen.

## Contrato

```
POST /v1/verify        Authorization: Bearer <token>   Content-Type: application/pdf
                       Idempotency-Key: <uuid>         (opcional, recomendado)
GET  /v1/engine        versión del motor de verificación
GET  /livez /healthz   públicos, sin clave
```

Respuestas que conviene distinguir:

| Código | Significa |
|---|---|
| `200` | Veredicto real. `overallStatus`: `valid` / `warning` / `invalid` / `no_signature` |
| `401` | Clave ausente, desconocida, revocada o caducada — indistinguibles a propósito |
| `422` | El documento no se puede procesar, o declara demasiadas firmas |
| `413` | Excede el tamaño, o el presupuesto `firmas × bytes` |
| `429` | Cuota agotada (`Retry-After`) o backstop antifuerza bruta |
| `502` | **Nuestro motor falló.** No es un veredicto sobre el documento |
| `503` | Servicio ocupado o worker caído |
| `504` | La verificación excedió su plazo |

La distinción entre `422` y `502` es deliberada y es lo que impide que un fallo
interno se presente como "esta firma es inválida".

## Gestión de claves

El fichero `/mnt/swarm-nfs/firma-ec-verify/api-keys.json` contiene registros,
nunca secretos: `keyId`, el HMAC del secreto y la cuota. Sin el pepper —que vive
en un Docker secret, en otro radio de exposición— no sirve de nada.

Revocar es poner `"status": "revoked"` y redeployar. Rotar el pepper invalida
**todas** las claves emitidas.

El token completo se muestra una sola vez al acuñarlo y no se puede recuperar.

## Riesgo residual conocido

- `MAX_SIGNATURES=10` podría rechazar actas legítimas con muchos firmantes.
  Calibrar contra documentos reales antes de abrir el piloto: aquí el fallo es
  una negativa, no un veredicto equivocado.
- `certCheck` sigue sin allowlist frente a SSRF. Hoy no es alcanzable desde
  `/v1/verify`, pero lo sería si esa ruta entrase en uso.
- `FETCH_OCSP=false` mientras `ocsp.firmar.ec` no resuelva.
- El Dockerfile no se ha construido nunca: no hay Docker en la máquina de
  desarrollo, así que el primer `docker build` ocurre en el servidor.

## Modelo comercial y cuotas

**La API alojada es un servicio de pago.** Lo gratuito es el *software*: AGPL-3.0,
corriendo en la infraestructura de quien lo use (`LICENSE` y
`LICENSE-COMMERCIAL.md`). Servir `api.firmar.ec` consume CPU, ancho de banda y
atención operativa de IDK Manager, y esa capacidad es la que no está disponible
para carga que sí paga. "El hardware ya está pagado" es un argumento de costo
hundido, no una razón para regalar capacidad.

Esto no contradice la promesa pública de firmar.ec: la licencia comercial ya
acota lo gratuito a *"la app web tal cual"* y ya nombra la **API** entre los
casos que requieren licencia comercial.

De ahí que solo existan dos formas de emitir una clave:

| Plan | Caduca | Cuota | Para qué |
|---|---|---|---|
| **Prueba** (default) | **sí**, 30 días | 50/día · 3/min · 1 concurrente | Evaluar la API y construir la integración |
| **Pago** | no (lo manda el contrato) | volumen **declarado** · 30/min · 2 concurrentes | Producción |

```bash
scripts/mint-verify-key.sh "Cliente"      live trial       # 30 días
scripts/mint-verify-key.sh "Cliente"      live trial 14    # 14 días
scripts/mint-verify-key.sh "Cliente S.A." live paid  5000  # 5.000/día, sin caducidad
```

**Una clave de pago no se puede acuñar sin declarar su volumen diario** — no hay
valor por defecto, a propósito. El riesgo de este modelo no es cobrar de menos:
es emitir por descuido una clave sin fecha de fin con la cuota de una prueba, que
es un plan gratuito permanente que nadie decidió.

De los tres límites, el que protege la máquina es `maxConcurrent`; un cubo por
minuto acota cuántas peticiones llegan, no cuánto trabajo corre a la vez. El
techo es **2**, que es el número de workers: pedir más no compra nada, y una sola
clave con 2 ocupa el motor entero. Hoy eso es tolerable con un cliente de pago;
con dos concurrentes hay que subir `VERIFY_WORKERS` y réplicas — lo que exige
Redis primero.

⚠️ **La cuota diaria es más blanda de lo que parece.** `InMemoryQuotaStore` cuenta
en memoria del proceso, así que **un redespliegue reinicia el contador del día**, y
el stack actualiza con `order: stop-first`. Sirve como defensa de capacidad, **no
como base para facturar**. Cobrar por volumen exige antes el token-bucket de Redis
(la misma pieza que impide la segunda réplica).

La **caducidad sí es firme**: `expiresAt` vive en el registro persistente, no en
los contadores. Por eso la prueba se limita por *fecha* y no por "N verificaciones
en total", que hoy no sería exigible.

La ventana diaria corta a las **00:00 UTC** = 19:00 en Ecuador continental. Para
el cliente se ve como una cuota que "se renueva a las 7 de la tarde".
