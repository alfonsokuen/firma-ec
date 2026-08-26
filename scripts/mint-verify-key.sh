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
# Uso:  scripts/mint-verify-key.sh "Nombre del cliente" [live|test] [version]
set -euo pipefail

NAME="${1:-}"
ENVIRONMENT="${2:-live}"
[[ -z "$NAME" ]] && { echo "uso: $0 \"Nombre del cliente\" [live|test] [version]"; exit 1; }
[[ "$ENVIRONMENT" == "live" || "$ENVIRONMENT" == "test" ]] || { echo "el entorno debe ser live o test"; exit 1; }

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$REPO_ROOT"
VERSION="${3:-$(grep '"version"' apps/verify-api/package.json | head -1 | sed -E 's/.*"version": "([^"]+)".*/\1/')}"

HOST="${IAS_HOST:-190.160.10.129}"
REGISTRY="${REGISTRY:-190.160.10.129:5000}"
IMAGE="$REGISTRY/firma-ec-verify:$VERSION"
KEYS_FILE="/mnt/swarm-nfs/firma-ec-verify/api-keys.json"
SVC="verify-mint-$$"

echo "==> Acunando clave \"$NAME\" ($ENVIRONMENT) con la imagen $VERSION"

# NOTA: sin `|| true` en ningun sitio. Un acunador que falla en silencio deja
# creyendo que la clave existe.
ssh root@"$HOST" "set -e
  docker service create --detach --restart-condition=none --name '$SVC' \
    --secret firma_verify_api_pepper --constraint 'node.role == manager' \
    '$IMAGE' \
    sh -c 'API_KEY_PEPPER=\$(cat /run/secrets/firma_verify_api_pepper) node dist/mint-key.js \"$NAME\" $ENVIRONMENT' >/dev/null

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
