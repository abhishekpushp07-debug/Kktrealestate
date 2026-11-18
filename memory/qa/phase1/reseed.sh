#!/bin/bash
# usage: reseed.sh AS_OF
B=http://127.0.0.1:8001/api
BY=$(grep -s LOGIN_RATE_LIMIT_BYPASS_TOKEN /proc/$(pgrep -f "uvicorn server:app" | head -1)/environ 2>/dev/null | tr '\0' '\n' | grep BYPASS | cut -d= -f2)
PW=$(grep ^DEMO_PASSWORD /app/backend/.env | cut -d= -f2)
TOK=$(curl -s -X POST $B/auth/login -H "Content-Type: application/json" -H "X-Rate-Limit-Bypass: ${BY:-kkt-test-bypass-local}" -d "{\"email\":\"admin@kkt.in\",\"password\":\"$PW\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
echo "start $(date -u +%T)"
curl -s -X POST $B/admin/reseed -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d "{\"confirm\":\"RESEED\",\"story\":true,\"as_of\":\"$1\"}" | head -c 300; echo
while true; do sleep 20; TOK2=$(curl -s -X POST $B/auth/login -H "Content-Type: application/json" -H "X-Rate-Limit-Bypass: ${BY:-kkt-test-bypass-local}" -d "{\"email\":\"admin@kkt.in\",\"password\":\"$PW\"}" | python3 -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null); [ -n "$TOK2" ] && TOK=$TOK2
 S=$(curl -s $B/admin/reseed/status -H "Authorization: Bearer $TOK"); echo "$(date -u +%T) $S"; echo "$S" | grep -q '"running"' || break; done
