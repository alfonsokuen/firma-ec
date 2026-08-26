#!/usr/bin/env bash
# Acuna una API key para firma-ec-verify.
#
# Corre el acunador DENTRO de un contenedor efimero en el servidor, con el
# Docker secret del pepper montado, para que el pepper no viaje ni aparezca en
# el historial de esta maquina. El token se imprime UNA vez: no se guarda en
# ningun sitio y no se puede recuperar (solo persistimos su HMAC).
#
# Uso:  scripts/mint-verify-key.sh "Nombre del cliente" [live|test] [version-imagen]
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

echo "==> Acunando clave \"$NAME\" ($ENVIRONMENT) con la imagen $VERSION"

# Un servicio one-shot de Swarm es la via para montar un secret: `docker run`
# no puede montar secrets de Swarm.
OUT="$(ssh root@"$HOST" "set -e
  docker service create --detach=false --restart-condition=none \
    --name verify-mint-\$\$ --network none \
    --secret firma_verify_api_pepper \
    --constraint 'node.role == manager' \
    '$IMAGE' \
    sh -c 'API_KEY_PEPPER=\$(cat /run/secrets/firma_verify_api_pepper) node dist/mint-key.js \"$NAME\" $ENVIRONMENT' \
    >/dev/null 2>&1 || true
  SVC=\$(docker service ls --filter name=verify-mint- --format '{{.Name}}' | head -1)
  docker service logs --raw \"\$SVC\" 2>&1
  docker service rm \"\$SVC\" >/dev/null 2>&1 || true")"

echo "$OUT"

cat <<EOF

==> Anade el REGISTRO (el bloque JSON de arriba, no el token) a:
      $KEYS_FILE

    En el servidor, con jq:
      ssh root@$HOST "jq '. + [\$REGISTRO]' $KEYS_FILE > /tmp/k && mv /tmp/k $KEYS_FILE"

    Y aplica: scripts/deploy-verify-api.sh   (el servicio relee el fichero al arrancar)

    El TOKEN va al cliente por un canal seguro y NO se guarda aqui. Si se
    pierde, se acuna otro y se revoca el viejo (status: "revoked" en el fichero).
EOF
