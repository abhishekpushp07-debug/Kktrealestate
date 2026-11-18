#!/bin/bash
# Trigger the nightly demo refresh by hand (POST /api/admin/demo-refresh/run) and poll until it finishes.
URL=$(grep REACT_APP_BACKEND_URL /app/frontend/.env | cut -d= -f2)
PW=$(grep ^DEMO_PASSWORD /app/backend/.env | cut -d= -f2)
tok() { curl -s -X POST $URL/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"admin@kkt.in\",\"password\":\"$PW\"}" | python3 -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))"; }
TOK=$(tok); echo "start $(date -u +%T)"
curl -s -X POST $URL/api/admin/demo-refresh/run -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d "${1:-{\}}"; echo
while true; do sleep 30; T=$(tok); [ -n "$T" ] && TOK=$T
 S=$(curl -s $URL/api/admin/demo-refresh -H "Authorization: Bearer $TOK" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['running'], (d['last'] or {}).get('outcome'), (d['last_done'] or {}).get('as_of'))" 2>&1)
 echo "$(date -u +%T) $S"; echo "$S" | grep -q "^True" || break; done
