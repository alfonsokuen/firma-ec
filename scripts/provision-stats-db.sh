#!/usr/bin/env bash
# Provisiona la base firmar_ec_stats (rol + DB + GRANT + migracion del esquema) +
# los Docker secrets del stats-backend.
#
# Patroni HA por HAProxy: postgres16_postgres:5432 (NUNCA pinear un nodo patroni).
# La overlay IASERVER_NET NO es attachable, asi que NO se puede `docker run
# --network IASERVER_NET`; en su lugar se hace `docker exec` dentro de un
# contenedor patroni del nodo (trae psql y esta en la red) y se conecta a
# postgres16_postgres (HAProxy -> lider) para que las escrituras caigan en el
# primario. Idempotente.
#
# Requiere (leelos de la boveda SOPS):
#   PGSUPERPASS = password del superusuario `postgres` de Patroni.
#   REDISPW     = password de redis-ha (exige AUTH).
# Genera STATSPW (password del rol firmar_ec_stats) y lo imprime para la boveda.
#
# Uso:  PGSUPERPASS='...' REDISPW='...' scripts/provision-stats-db.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$REPO_ROOT"
HOST="${IAS_HOST:-190.160.10.129}"
: "${PGSUPERPASS:?define PGSUPERPASS (superusuario postgres de Patroni, desde la boveda)}"
: "${REDISPW:?define REDISPW (password de redis-ha, desde la boveda; redis-ha exige AUTH)}"
STATSPW="${STATSPW:-$(openssl rand -hex 24)}"
DSN="postgresql://firmar_ec_stats:${STATSPW}@postgres16_postgres:5432/firmar_ec_stats?schema=public"
REDIS_URL="redis://:${REDISPW}@redis-ha:6379/11"   # DB11 = firmar-ec-stats (redis-ha exige AUTH; DB10 = inbox, 9 = chatwoot, 8 = microtk)
MIGRATION="apps/stats-backend/prisma/migrations/0000_init/migration.sql"
[[ -f "$MIGRATION" ]] || { echo "ERROR: no encuentro $MIGRATION"; exit 1; }

echo "==> [1/3] Subir el SQL de migracion a $HOST"
scp "$MIGRATION" root@"$HOST":/root/firma_stats_migration.sql

echo "==> [2/3] Rol + DB + GRANT + migracion (docker exec en patroni; idempotente)"
ssh root@"$HOST" "PGSUPERPASS='$PGSUPERPASS' STATSPW='$STATSPW' bash -s" <<'REMOTE'
set -euo pipefail
CID="$(docker ps -q -f name=patroni16_patroni | head -1)"
[ -n "$CID" ] || { echo "ERROR: no hay contenedor patroni en este nodo"; exit 1; }
# NO usar `-i` aqui: dentro de `ssh "bash -s" <<HEREDOC`, un `docker exec -i`
# sin redireccion se come el resto del heredoc por stdin. `</dev/null` lo blinda.
super() { docker exec -e PGPASSWORD="$PGSUPERPASS" "$CID" psql -h postgres16_postgres -U postgres -v ON_ERROR_STOP=1 "$@" </dev/null; }

if super -tAc "SELECT 1 FROM pg_roles WHERE rolname='firmar_ec_stats'" | grep -q 1; then
  echo "rol ya existia"
else
  super -c "CREATE ROLE firmar_ec_stats WITH LOGIN PASSWORD '$STATSPW'"; echo "rol creado"
fi

if super -tAc "SELECT 1 FROM pg_database WHERE datname='firmar_ec_stats'" | grep -q 1; then
  echo "base ya existia"
else
  super -c "CREATE DATABASE firmar_ec_stats OWNER firmar_ec_stats"; echo "base creada"
fi
super -d firmar_ec_stats -c "GRANT ALL ON SCHEMA public TO firmar_ec_stats"

echo "aplicando migracion como firmar_ec_stats..."
docker exec -e PGPASSWORD="$STATSPW" -i "$CID" \
  psql -h postgres16_postgres -U firmar_ec_stats -d firmar_ec_stats -v ON_ERROR_STOP=1 \
  < /root/firma_stats_migration.sql
echo "tablas en firmar_ec_stats:"
super -d firmar_ec_stats -tAc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1"
rm -f /root/firma_stats_migration.sql
REMOTE

echo "==> [3/3] Docker secrets (idempotente, SIN tragar errores reales)"
ssh root@"$HOST" "DSN='$DSN' REDIS_URL='$REDIS_URL' bash -s" <<'REMOTE'
set -euo pipefail
if docker secret ls --format '{{.Name}}' | grep -qx firma_stats_database_url; then
  echo "ya existia firma_stats_database_url"
else
  printf '%s' "$DSN" | docker secret create firma_stats_database_url -; echo "creado firma_stats_database_url"
fi
if docker secret ls --format '{{.Name}}' | grep -qx firma_stats_redis_url; then
  echo "ya existia firma_stats_redis_url"
else
  printf '%s' "$REDIS_URL" | docker secret create firma_stats_redis_url -; echo "creado firma_stats_redis_url"
fi
REMOTE

echo
echo "############################################################################"
echo "# GUARDA EN LA BOVEDA SOPS (mismo turno, credentials/credentials.sops.yaml):"
echo "#   apps_firmar_ec_stats:"
echo "#     db_password: '$STATSPW'"
echo "#     (database_url y redis_url se derivan; el redis_url lleva el pw de redis-ha)"
echo "############################################################################"
echo "STATSPW=$STATSPW"
