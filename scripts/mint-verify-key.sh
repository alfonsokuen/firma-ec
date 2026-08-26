#!/usr/bin/env bash
# Acuna una API key para firma-ec-verify.
#
# Corre el acunador DENTRO de un servicio efimero de Swarm con el Docker secret
# del pepper montado, para que el pepper no viaje ni quede en el historial de
# esta maquina. El token se imprime UNA vez: no se guarda en ningun sitio y no
# se puede recuperar (solo persistimos su HMAC).
#
# Dos detalles que costaron un intento fallido cada uno:
#   - `--network none` NO existe en Swarm (es una red local de Docker). Un
#     servicio sin `--network` no obtiene red externa, que es lo que queriamos.
#   - El REGISTRO sale por stderr del contenedor y el TOKEN por stdout, a
#     proposito, para poder capturar uno sin el otro. `docker service logs`
#     respeta esa separacion, asi que redirigir stderr a /dev/null borra
#     justamente el registro que hace falta.
#
# La API alojada es de PAGO; lo gratuito es el software bajo AGPL corriendo en la
# infraestructura de quien lo use. Por eso el plan por defecto es `trial` y lleva
# caducidad: una prueba que no caduca es un plan gratuito que nadie decidio.
#
# Uso:  scripts/mint-verify-key.sh "Nombre del cliente" [live|test] [trial|paid] [N]
#         trial [N]  N = dias de vigencia (por defecto 30)
#         paid  N    N = volumen diario contratado (OBLIGATORIO)
#       La version de imagen se toma de package.json; sobreescribible con VERIFY_VERSION.
set -euo pipefail

NAME="${1:-}"
ENVIRONMENT="${2:-live}"
PLAN="${3:-trial}"
AMOUNT="${4:-}"
[[ -z "$NAME" ]] && { echo "uso: $0 \"Nombre del cliente\" [live|test] [trial|paid] [N]"; exit 1; }
[[ "$ENVIRONMENT" == "live" || "$ENVIRONMENT" == "test" ]] || { echo "el entorno debe ser live o test"; exit 1; }
[[ "$PLAN" == "trial" || "$PLAN" == "paid" ]] || { echo "el plan debe ser trial o paid"; exit 1; }
[[ "$PLAN" == "paid" && -z "$AMOUNT" ]] && { echo "una clave de pago debe declarar su volumen diario: $0 \"Nombre\" live paid <N>"; exit 1; }

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$REPO_ROOT"
VERSION="${VERIFY_VERSION:-$(grep '"version"' apps/verify-api/package.json | head -1 | sed -E 's/.*"version": "([^"]+)".*/\1/')}"

. "$REPO_ROOT/scripts/_deploy-env.sh"
IMAGE="$REGISTRY/firma-ec-verify:$VERSION"
KEYS_FILE="/mnt/swarm-nfs/firma-ec-verify/api-keys.json"
SVC="verify-mint-$$"

echo "==> Acunando clave \"$NAME\" ($ENVIRONMENT, plan $PLAN ${AMOUNT:+$AMOUNT}) con la imagen $VERSION"

# NOTA: sin `|| true` en ningun sitio. Un acunador que falla en silencio deja
# creyendo que la clave existe.
ssh root@"$HOST" "set -e
  docker service create --detach --restart-condition=none --name '$SVC' \
    --secret firma_verify_api_pepper --constraint 'node.role == manager' \
    '$IMAGE' \
    sh -c 'API_KEY_PEPPER=\$(cat /run/secrets/firma_verify_api_pepper) node dist/mint-key.js \"$NAME\" $ENVIRONMENT $PLAN $AMOUNT' >/dev/null

  for i in \$(seq 1 30); do
    st=\$(docker service ps '$SVC' --format '{{.CurrentState}}' 2>/dev/null | head -1)
    case \"\$st\" in Complete*) break;; Failed*|Rejected*)
      echo \"ERROR: el acunador fallo: \$(docker service ps '$SVC' --no-trunc --format '{{.Error}}' | head -1)\"
      docker service rm '$SVC' >/dev/null 2>&1
      exit 1;; esac
    sleep 2
  done

  docker service logs --raw '$SVC' > /tmp/mint.out 2> /tmp/mint.err
  sed -n '/^{/,/^}/p' /tmp/mint.err > /tmp/newkey.json
  if [ ! -s /tmp/newkey.json ]; then
    echo 'ERROR: no pude extraer el registro de la clave'
    docker service rm '$SVC' >/dev/null 2>&1
    exit 1
  fi

  echo '--- REGISTRO (se anade al fichero de claves) ---'
  cat /tmp/newkey.json
  echo
  echo '--- TOKEN (se muestra UNA vez; entregalo por canal seguro) ---'
  grep -o 'fev_[a-z]*_[A-Za-z0-9_]*' /tmp/mint.out | head -1

  cp '$KEYS_FILE' '$KEYS_FILE.bak.'\$(date +%Y%m%d-%H%M%S)
  python3 -c \"
import json
keys = json.load(open('$KEYS_FILE'))
keys.append(json.load(open('/tmp/newkey.json')))
json.dump(keys, open('$KEYS_FILE','w'), indent=2)
\"
  chmod 640 '$KEYS_FILE'
  echo
  echo '--- claves configuradas ahora: '\$(grep -c '\"keyId\"' '$KEYS_FILE')' ---'

  docker service rm '$SVC' >/dev/null 2>&1
  rm -f /tmp/mint.out /tmp/mint.err /tmp/newkey.json"

cat <<EOF

==> La clave ya esta en $KEYS_FILE.
    Aplica con:  scripts/deploy-verify-api.sh
    (el servicio relee el fichero al arrancar)

    Revocar: pon "status": "revoked" en su registro y redeploya.
EOF
