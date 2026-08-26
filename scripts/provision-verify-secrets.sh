#!/usr/bin/env bash
# Provisiona lo que firma-ec-verify necesita antes del primer despliegue.
#
#   1. Docker secret `firma_verify_api_pepper` — el pepper HMAC. ES un secreto.
#   2. Fichero NFS con los registros de clave. NO es un secreto: solo lleva
#      keyId, el HMAC del secreto y la cuota. Sin el pepper no sirve de nada.
#
# Esa separacion es el punto: llevarse la lista de claves no da acceso, porque
# el pepper vive en otro radio de exposicion. Y como la lista no es secreta,
# puede ser un fichero editable — anadir o revocar una clave es editarlo y
# redeployar, en vez de recrear un secret inmutable de Swarm.
#
# Uso:  scripts/provision-verify-secrets.sh
set -euo pipefail

HOST="${IAS_HOST:-190.160.10.129}"
KEYS_DIR="/mnt/swarm-nfs/firma-ec-verify"
KEYS_FILE="$KEYS_DIR/api-keys.json"

echo "==> Provisionando firma-ec-verify en root@$HOST"

echo "==> [1/2] Pepper (Docker secret)"
if ssh root@"$HOST" 'docker secret ls --format "{{.Name}}" | grep -qx firma_verify_api_pepper'; then
  echo "    ya existe — NO se toca."
  echo "    ROTARLO INVALIDA TODAS LAS CLAVES EMITIDAS. Hazlo a proposito, nunca de paso."
else
  # Se genera EN el servidor: asi el pepper no pasa por esta maquina ni por
  # ningun log intermedio.
  ssh root@"$HOST" 'openssl rand -base64 48 | tr -d "\n" | docker secret create firma_verify_api_pepper -'
  echo "    creado (48 bytes del CSPRNG del servidor)"
fi

echo "==> [2/2] Fichero de claves en NFS"
ssh root@"$HOST" "set -e
  mkdir -p '$KEYS_DIR'
  if [ -f '$KEYS_FILE' ]; then
    echo '    ya existe, con' \$(grep -o '\"keyId\"' '$KEYS_FILE' | wc -l) 'clave(s) — NO se toca.'
  else
    # Arranca vacio A PROPOSITO: el servicio se NIEGA a arrancar en produccion
    # con la lista vacia, de modo que hay que acunar la primera clave antes de
    # desplegar. Un servicio arriba al que nadie puede entrar se parece
    # demasiado a un servicio roto.
    printf '[]' > '$KEYS_FILE'
    chmod 640 '$KEYS_FILE'
    echo '    creado vacio'
  fi"

cat <<EOF

==> Siguiente paso: acuna la primera clave

      scripts/mint-verify-key.sh "Nombre del cliente"

    Imprime el token UNA vez (no se puede recuperar) y anade su registro a
    $KEYS_FILE. El pepper nunca sale del servidor.

    Despues:  scripts/deploy-verify-api.sh
EOF
