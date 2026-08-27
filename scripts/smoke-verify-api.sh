#!/usr/bin/env bash
# Smoke de la API de verificacion DESPLEGADA, por la ruta publica real.
#
# Complementa a `tests/built-bundle.test.ts`, no lo repite: aquel prueba el
# bundle en localhost, este atraviesa Cloudflare, el tunel y Traefik. Los dos
# fallos que solo se ven aqui son un edge mal enrutado y un certificado o un
# tunel caidos — el bundle puede estar perfecto y el servicio inalcanzable.
#
# La clave NO tiene valor por defecto: se pasa por entorno. Un smoke con una
# credencial incrustada acaba en el repo, y este repo tiene espejo publico.
#
# Uso:
#   VERIFY_API_KEY=fev_live_... scripts/smoke-verify-api.sh [base-url]
#
# Salida: 0 si TODAS las comprobaciones pasan; 1 a la primera que falle.
set -uo pipefail

BASE="${1:-https://api.firmar.ec}"
KEY="${VERIFY_API_KEY:?falta VERIFY_API_KEY (no hay default a proposito)}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$REPO_ROOT"
FIX="packages/verifier/tests/fixtures"
SIGNED="$FIX/eci-real-signed.pdf"
TAMPERED="$FIX/incremental-tampered.pdf"
for f in "$SIGNED" "$TAMPERED"; do
  [[ -f "$f" ]] || { echo "FALTA el fixture $f"; exit 1; }
done

fails=0
ok()   { printf '  \033[32mOK\033[0m   %s\n' "$1"; }
bad()  { printf '  \033[31mFALLA\033[0m %s\n       %s\n' "$1" "$2"; fails=$((fails+1)); }

echo "==> Smoke contra $BASE"

# --- 1. Vivo -----------------------------------------------------------------
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$BASE/livez" || echo 000)
[[ "$code" == "200" ]] && ok "/livez responde 200" || bad "/livez" "http=$code"

# --- 2. Anclas de confianza completas ----------------------------------------
# Unas anclas incompletas NO rompen nada visible: marcan como no confiables
# firmas legitimas, y eso desde fuera se ve igual que un documento adulterado.
health=$(curl -sS --max-time 20 "$BASE/healthz" || echo '{}')
read -r usable declared <<<"$(printf '%s' "$health" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  try{const j=JSON.parse(s);process.stdout.write(`${j.usableAnchors??-1} ${j.declaredAnchors??-1}`);}
  catch{process.stdout.write("-1 -1");}});')"
if [[ "$usable" -gt 0 && "$usable" == "$declared" ]]; then
  ok "anclas de confianza $usable/$declared utilizables"
else
  bad "anclas de confianza" "usable=$usable declared=$declared"
fi

# --- 3. La version publicada no miente ---------------------------------------
remote_ver=$(curl -sS --max-time 20 "$BASE/v1/openapi.json" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  try{process.stdout.write(JSON.parse(s).info.version||"?");}catch{process.stdout.write("?");}});')
local_ver=$(grep '"version"' apps/verify-api/package.json | head -1 | sed -E 's/.*"([0-9][^"]*)".*/\1/')
if [[ "$remote_ver" == "$local_ver" ]]; then
  ok "version desplegada $remote_ver == repo"
else
  # Aviso, no fallo: el repo va por delante entre un merge y su despliegue.
  printf '  \033[33mAVISO\033[0m version desplegada=%s, repo=%s (¿falta desplegar?)\n' "$remote_ver" "$local_ver"
fi

# --- 4. Una firma real se verifica -------------------------------------------
body=$(curl -sS --max-time 90 -X POST "$BASE/v1/verify" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/pdf' \
  --data-binary "@$SIGNED" || echo '{}')
read -r n status <<<"$(printf '%s' "$body" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  try{const j=JSON.parse(s);process.stdout.write(`${j.signatureCount??-1} ${j.overallStatus??"?"}`);}
  catch{process.stdout.write("-1 ?");}});')"
if [[ "$n" -gt 0 && "$status" =~ ^(valid|warning|invalid)$ ]]; then
  ok "firma real: $n firma(s), veredicto '$status'"
else
  bad "firma real" "signatureCount=$n overallStatus=$status"
fi

# --- 5. EN ROJO: un documento alterado sale invalid ---------------------------
# Sin esto, el paso 4 pasaria igual con un motor que dijera "valid" a todo.
tstatus=$(curl -sS --max-time 90 -X POST "$BASE/v1/verify" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/pdf' \
  --data-binary "@$TAMPERED" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  try{process.stdout.write(JSON.parse(s).overallStatus||"?");}catch{process.stdout.write("?");}});')
[[ "$tstatus" == "invalid" ]] && ok "documento alterado -> invalid" \
  || bad "documento alterado" "esperaba invalid, obtuve '$tstatus'"

# --- 6. Sin clave, 401 -------------------------------------------------------
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 -X POST "$BASE/v1/verify" \
  -H 'Content-Type: application/pdf' --data-binary "@$SIGNED" || echo 000)
[[ "$code" == "401" ]] && ok "sin clave -> 401" || bad "sin clave" "http=$code (esperaba 401)"

echo
if [[ "$fails" -eq 0 ]]; then
  echo "==> SMOKE VERDE"
  exit 0
fi
echo "==> SMOKE ROJO: $fails comprobacion(es) fallaron"
exit 1
