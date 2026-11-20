#!/usr/bin/env bash
# Phase E6 smoke: scripts/smoke.sh <base_url>   (optionally KKT_TOKEN=<jwt> for the authenticated check,
# or KKT_EMAIL/KKT_PASSWORD to obtain one)
set -u
BASE="${1:-${REACT_APP_BACKEND_URL:-}}"
[ -z "$BASE" ] && { echo "usage: smoke.sh <base_url>"; exit 2; }
BASE="${BASE%/}"
pass=0; fail=0
row() { printf "| %-28s | %-6s | %-5s | %s\n" "$1" "$2" "$3" "$4"; }
check() { # name path expect_code [grep]
  local name="$1" path="$2" want="$3" needle="${4:-}" code body t0 t1 ms
  t0=$(date +%s%N); body=$(curl -s -m 15 -w '\n%{http_code}' "$BASE$path"); t1=$(date +%s%N)
  code=$(printf '%s' "$body" | tail -n1); body=$(printf '%s' "$body" | sed '$d'); ms=$(( (t1 - t0) / 1000000 ))
  if [ "$code" = "$want" ] && { [ -z "$needle" ] || printf '%s' "$body" | grep -q "$needle"; }; then row "$name" "$code" "PASS" "${ms}ms"; pass=$((pass+1)); else row "$name" "$code" "FAIL" "${ms}ms (want $want${needle:+, body~$needle})"; fail=$((fail+1)); fi
}
echo "# Smoke · $BASE · $(date -u +%FT%TZ)"
echo "| Check | HTTP | Result | Note"; echo "|---|---|---|---|"
check "GET /" "/" 200 "<div id=\"root\""
check "GET /login" "/login" 200 "<div id=\"root\""
check "GET /api/health" "/api/health" 200 '"status"'
check "GET /api/ready" "/api/ready" 200 ""
check "GET /api/openapi.json" "/api/openapi.json" 200 '"openapi"'
TOKEN="${KKT_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -n "${KKT_EMAIL:-}" ] && [ -n "${KKT_PASSWORD:-}" ]; then
  TOKEN=$(curl -s -m 15 -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' ${KKT_BYPASS:+-H "X-Rate-Limit-Bypass: $KKT_BYPASS"} -d "{\"email\":\"$KKT_EMAIL\",\"password\":\"$KKT_PASSWORD\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))' 2>/dev/null)
fi
if [ -n "$TOKEN" ]; then
  t0=$(date +%s%N); code=$(curl -s -m 15 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$BASE/api/bootstrap"); t1=$(date +%s%N)
  if [ "$code" = "200" ]; then row "GET /api/bootstrap (auth)" "$code" "PASS" "$(( (t1-t0)/1000000 ))ms"; pass=$((pass+1)); else row "GET /api/bootstrap (auth)" "$code" "FAIL" "token rejected"; fail=$((fail+1)); fi
else
  row "GET /api/bootstrap (auth)" "-" "SKIP" "set KKT_TOKEN or KKT_EMAIL/KKT_PASSWORD"
fi
echo; echo "PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ]
