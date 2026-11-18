#!/bin/bash
# REQ-306 repair of kkt_medium trends (derived data only): dry run = tieout FAIL row; repair = POST /api/admin/recompute-read-models (x2, idempotent)
cd /app/backend
L=/app/memory/qa/db_audit/gate/medium_repair.log; : > $L
DB_NAME=kkt_medium LOGIN_RATE_LIMIT_BYPASS_TOKEN=kkt-test-bypass-local KKT_ROLE=test BACKUP_ENABLED=0 DEMO_AUTO_REFRESH=false \
  nohup python -m uvicorn server:app --host 127.0.0.1 --port 8002 --log-level warning > /tmp/tie_kkt_medium.log 2>&1 &
P=$!
for i in $(seq 1 120); do curl -s localhost:8002/api/health | grep -q '"done":true' && break; sleep 1; done
T=$(curl -s -X POST localhost:8002/api/auth/login -H "X-Rate-Limit-Bypass: kkt-test-bypass-local" -H "Content-Type: application/json" -d '{"email":"admin@kkt.in","password":"Kkt@12345"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
python3 -c "from pymongo import MongoClient;d=MongoClient()['kkt_medium'];print('money before', d.payments.count_documents({}), d.demands.count_documents({}), d.ledger_entries.count_documents({}), sum(b.get('summary',{}).get('outstanding_paise',0) for b in d.bookings.find()))" >> $L
for run in 1 2; do
  echo "recompute run $run: $(curl -s -X POST localhost:8002/api/admin/recompute-read-models -H "Authorization: Bearer $T")" >> $L
  python3 -c "from pymongo import MongoClient;d=MongoClient()['kkt_medium'];print('bucket 2026-11', d.monthly_buckets.find_one({'scope':'company','month':'2026-11'},{'_id':0,'collections_cash':1,'collections_account':1,'collections_other':1}))" >> $L
done
python3 -c "from pymongo import MongoClient;d=MongoClient()['kkt_medium'];print('money after', d.payments.count_documents({}), d.demands.count_documents({}), d.ledger_entries.count_documents({}), sum(b.get('summary',{}).get('outstanding_paise',0) for b in d.bookings.find()))" >> $L
DB_NAME=kkt_medium LOGIN_RATE_LIMIT_BYPASS_TOKEN=kkt-test-bypass-local python tools/tieout.py --base http://localhost:8002 \
  --out /app/memory/qa/db_audit/gate/tieout_kkt_medium.md > /app/memory/qa/db_audit/gate/tieout_kkt_medium.log 2>&1
echo "tieout exit $?" >> $L
kill $P
echo DONE >> $L
