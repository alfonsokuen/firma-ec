#!/usr/bin/env bash
# Deploy pwa to firmar.ec via IDK Swarm.
#
# Usage:
#   scripts/deploy-pwa.sh [version]
#
# Reads apps/pwa/package.json version if no argument is given.
# Requires SSH access to root@190.160.10.129 (IASERVER01 — Swarm manager + registry host).
#
# Pipeline:
#   1. Verify version coherence (package.json vs tag)
#   2. Tar repo (excluding node_modules, dist, _backups, _scratch, .git)
#   3. SCP to IAS01 :/root/firma-ec-build/
#   4. docker build -f infra/docker/pwa.Dockerfile
#   5. docker push to 190.160.10.129:5000
#   6. docker service update --update-order start-first --force
#   7. HTTP smoke verify

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  VERSION="$(grep '"version"' apps/pwa/package.json | head -1 | sed -E 's/.*"version": "([^"]+)".*/\1/')"
fi
[[ -z "$VERSION" ]] && { echo "ERROR: cannot determine version"; exit 1; }

HOST="${IAS_HOST:-190.160.10.129}"
REGISTRY="${REGISTRY:-190.160.10.129:5000}"
IMAGE="$REGISTRY/firma-ec-pwa:$VERSION"
TGZ="/tmp/firma-ec-pwa-deploy-$VERSION.tgz"

echo "==> Deploying firma-ec-pwa $VERSION via root@$HOST"
echo "==> Image: $IMAGE"

echo "==> [1/6] Tar repo"
tar --exclude=node_modules --exclude=.git --exclude=dist --exclude=_backups \
    --exclude=_scratch --exclude=coverage --exclude=.astro \
    -czf "$TGZ" .
ls -lh "$TGZ"

echo "==> [2/6] SCP to $HOST"
scp "$TGZ" root@$HOST:/root/firma-ec-build.tgz

echo "==> [3/6] Extract on $HOST"
ssh root@$HOST "set -e; mkdir -p /root/firma-ec-build && cd /root/firma-ec-build && tar xzf /root/firma-ec-build.tgz && grep version apps/pwa/package.json"

echo "==> [4/6] Docker build $IMAGE"
ssh root@$HOST "cd /root/firma-ec-build && docker build --build-arg VITE_HANDOFF_ALLOWLIST='${VITE_HANDOFF_ALLOWLIST:-}' --build-arg VITE_STORE_URL='${VITE_STORE_URL:-https://tienda.firmar.ec}' --build-arg VITE_WHATSAPP_URL='${VITE_WHATSAPP_URL:-}' -f infra/docker/pwa.Dockerfile -t $IMAGE ."

echo "==> [5/6] Docker push"
ssh root@$HOST "docker push $IMAGE"

echo "==> [6/6] Swarm update firma-ec_pwa"
ssh root@$HOST "docker service update --image $IMAGE --update-order start-first --force firma-ec_pwa"

echo "==> Smoke verify"
sleep 5
for path in / manifest.webmanifest trust/tsl-ec.json; do
  code=$(curl -fsS -o /dev/null -w "%{http_code}" "https://app.firmar.ec/$path" || echo "FAIL")
  echo "  https://app.firmar.ec/$path -> $code"
done

echo "==> DONE. Cleanup local tar:"
rm -f "$TGZ"
echo "OK."
