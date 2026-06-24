#!/usr/bin/env bash
# Provisiona la base firmar_ec_stats + los Docker secrets del stats-backend.
#
# Patroni HA por HAProxy: postgres16_postgres:5432 (NUNCA pinear un nodo patroni).
# Idempotente. Corre los pasos de DB con psql desde un contenedor efimero en la
# overlay IASERVER_NET (postgres16_postgres solo resuelve dentro del Swarm).
#
# Requiere: PGSUPERPASS = password del superusuario `postgres` de Patroni
#           (leelo de la boveda SOPS). Genera STATSPW (password del rol
#           firmar_ec_stats), crea los Docker secrets, y te imprime la linea
#           EXACTA a guardar en la boveda.
#
# Uso:  PGSUPERPASS='...' scripts/provision-stats-db.sh
set -euo pipefail

HOST="${IAS_HOST:-190.160.10.129}"
: "${PGSUPERPASS:?define PGSUPERPASS (superusuario postgres de Patroni, desde la boveda)}"
STATSPW="${STATSPW:-$(openssl rand -hex 24)}"
DSN="postgresql://firmar_ec_stats:${STATSPW}@postgres16_postgres:5432/firmar_ec_stats?schema=public"
REDIS_URL="redis://redis-ha:6379/11"   # DB11 = firmar-ec-stats (DB10 = inbox, 9 = chatwoot, 8 = microtk)

# psql -U postgres dentro de la overlay (no exponemos el superusuario al host).
PSQL="docker run --rm --network IASERVER_NET -e PGPASSWORD='$PGSUPERPASS' postgres:16-alpine psql -h postgres16_postgres -U postgres -v ON_ERROR_STOP=1"

echo "==> [1/4] Rol firmar_ec_stats (idempotente)"
ssh root@"$HOST" "set -e
  if $PSQL -tAc \"SELECT 1 FROM pg_roles WHERE rolname='firmar_ec_stats'\" | grep -q 1; then
    echo 'rol ya existia'
  else
    $PSQL -c \"CREATE ROLE firmar_ec_stats WITH LOGIN PASSWORD '$STATSPW'\"
  fi"

echo "==> [2/4] Base firmar_ec_stats (idempotente; CREATE DATABASE no va en transaccion)"
ssh root@"$HOST" "set -e
  if $PSQL -tAc \"SELECT 1 FROM pg_database WHERE datname='firmar_ec_stats'\" | grep -q 1; then
    echo 'base ya existia'
  else
    $PSQL -c \"CREATE DATABASE firmar_ec_stats OWNER firmar_ec_stats\"
  fi
  docker run --rm --network IASERVER_NET -e PGPASSWORD='$PGSUPERPASS' postgres:16-alpine \
    psql -h postgres16_postgres -U postgres -d firmar_ec_stats -v ON_ERROR_STOP=1 \
    -c 'GRANT ALL ON SCHEMA public TO firmar_ec_stats'"

echo "==> [3/4] Docker secrets (idempotente, SIN tragar errores reales de creacion)"
ssh root@"$HOST" "set -e
  if docker secret ls --format '{{.Name}}' | grep -qx firma_stats_database_url; then
    echo 'ya existia firma_stats_database_url'
  else
    printf '%s' '$DSN' | docker secret create firma_stats_database_url -; echo 'creado firma_stats_database_url'
  fi
  if docker secret ls --format '{{.Name}}' | grep -qx firma_stats_redis_url; then
    echo 'ya existia firma_stats_redis_url'
  else
    printf '%s' '$REDIS_URL' | docker secret create firma_stats_redis_url -; echo 'creado firma_stats_redis_url'
  fi"

echo "==> [4/4] Migracion de esquema — aplica el SQL de Prisma contra la nueva DB."
echo "    Tras shippear el repo con deploy-stats.sh (deja /root/firma-ec-stats-build en $HOST), corre:"
echo
echo "    ssh root@$HOST \"docker run --rm --network IASERVER_NET -e PGPASSWORD='\$STATSPW' \\"
echo "      -v /root/firma-ec-stats-build/apps/stats-backend/prisma/migrations:/m:ro postgres:16-alpine \\"
echo "      psql -h postgres16_postgres -U firmar_ec_stats -d firmar_ec_stats -v ON_ERROR_STOP=1 \\"
echo "      -f /m/0000_init/migration.sql\""
echo "    (reemplaza \\\$STATSPW por el valor impreso abajo)."
echo
echo "############################################################################"
echo "# GUARDA EN LA BOVEDA SOPS (mismo turno, credentials/credentials.sops.yaml):"
echo "#   apps_firmar_ec_stats:"
echo "#     db_password:  '$STATSPW'"
echo "#     database_url: '$DSN'"
echo "#     redis_url:    '$REDIS_URL'"
echo "############################################################################"
echo "STATSPW=$STATSPW"
