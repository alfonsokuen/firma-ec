#!/usr/bin/env bash
# Despliega firma-ec-stats (backend de usage-stats) como STACK DEDICADO
# `firma-ec-stats` — totalmente separado del stack firma-ec (landing/pwa), que NO
# se toca. Levanta el servicio SIN cortar trafico publico: el CF Worker sigue
# duenno de /api/stats* en el edge hasta que corras scripts/cutover-stats.sh.
#
# Pre-requisito: scripts/provision-stats-db.sh ya corrio (DB firmar_ec_stats +
# Docker secrets firma_stats_database_url / firma_stats_redis_url) Y el esquema
# fue migrado (paso 5 de provision).
#
# Uso:  scripts/deploy-stats.sh [version]   (default: apps/stats-backend/package.json)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$REPO_ROOT"
VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  VERSION="$(grep '"version"' apps/stats-backend/package.json | head -1 | sed -E 's/.*"version": "([^"]+)".*/\1/')"
fi
[[ -z "$VERSION" ]] && { echo "ERROR: no pude determinar la version"; exit 1; }

HOST="${IAS_HOST:-190.160.10.129}"
REGISTRY="${REGISTRY:-190.160.10.129:5000}"
IMAGE="$REGISTRY/firma-ec-stats:$VERSION"
STACK_FILE="infra/compose/stack-firma-ec-stats.deploy.yml"
TGZ="/tmp/firma-ec-stats-deploy-$VERSION.tgz"

echo "==> Desplegando firma-ec-stats $VERSION via root@$HOST  (image $IMAGE)"

echo "==> [1/7] Pre-flight: los Docker secrets deben existir"
ssh root@"$HOST" 'for s in firma_stats_database_url firma_stats_redis_url; do
  docker secret ls --format "{{.Name}}" | grep -qx "$s" || { echo "FALTA secret $s -> corre scripts/provision-stats-db.sh primero"; exit 1; }
done; echo "secrets OK"'

echo "==> [2/7] Tar del repo"
tar --exclude=node_modules --exclude=.git --exclude=dist --exclude=_backups \
    --exclude=_scratch --exclude=coverage --exclude=.astro \
    -czf "$TGZ" .
ls -lh "$TGZ"

echo "==> [3/7] SCP a $HOST"
scp "$TGZ" root@"$HOST":/root/firma-ec-stats-build.tgz

echo "==> [4/7] Extraer limpio en $HOST"
ssh root@"$HOST" "set -e; rm -rf /root/firma-ec-stats-build && mkdir -p /root/firma-ec-stats-build && cd /root/firma-ec-stats-build && tar xzf /root/firma-ec-stats-build.tgz && grep version apps/stats-backend/package.json"

echo "==> [5/7] Docker build + push"
ssh root@"$HOST" "cd /root/firma-ec-stats-build && docker build -f apps/stats-backend/Dockerfile -t $IMAGE . && docker push $IMAGE"

echo "==> [6/7] Stack deploy DEDICADO (firma-ec-stats) — landing/pwa NO se tocan"
ssh root@"$HOST" "cd /root/firma-ec-stats-build && STATS_TAG=$VERSION docker stack deploy -c $STACK_FILE firma-ec-stats --with-registry-auth"

echo "==> [7/7] Esperar readiness (2/2) + smoke de ORIGEN BLOQUEANTE (worker aun sirve el publico)"
REPL=""
# '.Replicas' puede venir como "2/2 (max 1 per node)" cuando hay placement
# constraints; comparar por PREFIJO "2/2", no exacto.
for i in $(seq 1 30); do
  REPL="$(ssh root@"$HOST" "docker service ls --filter name=firma-ec-stats_stats --format '{{.Replicas}}'" || true)"
  echo "  replicas: ${REPL:-<none>} (intento $i/30)"
  [[ "$REPL" == 2/2* ]] && break
  sleep 4
done
if [[ "$REPL" != 2/2* ]]; then
  echo "ERROR: el servicio no llego a 2/2"
  ssh root@"$HOST" "docker service ps firma-ec-stats_stats --no-trunc | head -20" || true
  exit 1
fi

echo "-- smoke de origen GET /api/stats (bypass CF via --resolve a Traefik) --"
OK=0
for i in $(seq 1 15); do
  CODE="$(curl -sk -o /tmp/stats-smoke.json -w '%{http_code}' --resolve firmar.ec:443:"$HOST" "https://firmar.ec/api/stats" || echo 000)"
  echo "  HTTP $CODE (intento $i/15)"
  [[ "$CODE" == "200" ]] && { OK=1; break; }
  sleep 2
done
[[ "$OK" == "1" ]] || { echo "ERROR: smoke de origen /api/stats no dio 200"; exit 1; }
echo "  body: $(cat /tmp/stats-smoke.json)"

echo "-- smoke GET /api/stats/series?granularity=day --"
OK2=0
for i in $(seq 1 15); do
  CODE="$(curl -sk -o /dev/null -w '%{http_code}' --resolve firmar.ec:443:"$HOST" "https://firmar.ec/api/stats/series?granularity=day" || echo 000)"
  echo "  HTTP $CODE (intento $i/15)"
  [[ "$CODE" == "200" ]] && { OK2=1; break; }
  sleep 2
done
[[ "$OK2" == "1" ]] || { echo "ERROR: /api/stats/series no dio 200"; exit 1; }

echo "==> LISTO. Servicio arriba y validado en ORIGEN. NO sirve trafico publico todavia."
echo "    Siguiente: scripts/cutover-stats.sh (seed + quitar rutas del Worker)."
rm -f "$TGZ"
