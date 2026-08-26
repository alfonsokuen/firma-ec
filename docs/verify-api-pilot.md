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
