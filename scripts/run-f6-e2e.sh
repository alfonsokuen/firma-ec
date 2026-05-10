#!/usr/bin/env bash
# F6 Batch V — run the TSA E2E suite against a local preview build.
#
# Documents the exact procedure the user / CI should follow. The suite was
# stripped of `test.fixme` in commit 8f3b88a (F6 T20). TSA-4 auto-skips if
# `apps/pwa/tests/e2e/fixtures/sample-b-t.pdf` is missing — generate it with
# `scripts/gen-f6-samples.mjs` (Node + signer fallback, no browser needed).
#
# Real FreeTSA hits: the suite mocks /tsr via `page.route()`, so the browser
# does NOT call FreeTSA during E2E. Only `gen-f6-samples.mjs` makes a real
# FreeTSA call (rate limit ~5 req/min/IP).
#
# Usage:
#   bash scripts/run-f6-e2e.sh           # full run
#   bash scripts/run-f6-e2e.sh --list    # parse-check only

set -euo pipefail
cd "$(dirname "$0")/.."

LIST_ONLY=${1:-}

echo "[f6-e2e] 1/4 build PWA"
pnpm -F @firma-ec/pwa build

echo "[f6-e2e] 2/4 ensure B-T fixture"
if [[ ! -f apps/pwa/tests/e2e/fixtures/sample-b-t.pdf ]]; then
  echo "[f6-e2e]   missing — running gen-f6-samples.mjs"
  pnpm -F @firma-ec/signer build
  pnpm -F @firma-ec/tsa-client build
  # Patch tsa-client dist with .js extensions (TS strict ESM workaround)
  (cd packages/tsa-client/dist && for f in *.js; do
    sed -i -E "s|from '(\./[a-zA-Z][a-zA-Z0-9_-]*)'|from '\1.js'|g" "$f"
  done)
  # Temp switch tsa-client main → dist for the Node run
  cp packages/tsa-client/package.json /tmp/tsa-client-pkg.json.bak
  trap 'cp /tmp/tsa-client-pkg.json.bak packages/tsa-client/package.json' EXIT
  sed -i 's|"main": "./src/index.ts"|"main": "./dist/index.js"|; s|"types": "./src/index.ts"|"types": "./dist/index.d.ts"|' \
    packages/tsa-client/package.json
  node scripts/gen-f6-samples.mjs
fi

echo "[f6-e2e] 3/4 boot preview on :5174 (background)"
pnpm -F @firma-ec/pwa preview --port 5174 --host 127.0.0.1 &
PREVIEW_PID=$!
trap 'kill $PREVIEW_PID 2>/dev/null || true' EXIT
# Wait for preview to be ready
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null http://127.0.0.1:5174/; then break; fi
  sleep 1
done

echo "[f6-e2e] 4/4 playwright run"
export FIRMA_BASE_URL=http://127.0.0.1:5174
if [[ "$LIST_ONLY" == "--list" ]]; then
  pnpm -F @firma-ec/pwa exec playwright test apps/pwa/tests/e2e/tsa-flow.spec.ts --list
else
  pnpm -F @firma-ec/pwa exec playwright test apps/pwa/tests/e2e/tsa-flow.spec.ts \
    --project=chromium --reporter=list 2>&1 | tee _backups/F6-e2e-2026-05-10/playwright-output.txt
fi
