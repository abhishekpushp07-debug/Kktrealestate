#!/bin/bash
# tieout on kkt_medium / kkt_volume through a private backend (:8002, no reload, demo refresh off) — read-only GETs.
cd /app/backend
for DB in kkt_medium kkt_volume; do
  DB_NAME=$DB LOGIN_RATE_LIMIT_BYPASS_TOKEN=kkt-test-bypass-local KKT_ROLE=test BACKUP_ENABLED=0 DEMO_AUTO_REFRESH=false \
    nohup python -m uvicorn server:app --host 127.0.0.1 --port 8002 --log-level warning > /tmp/tie_$DB.log 2>&1 &
  P=$!
  for i in $(seq 1 120); do curl -s localhost:8002/api/health | grep -q '"done":true' && break; sleep 1; done
  DB_NAME=$DB LOGIN_RATE_LIMIT_BYPASS_TOKEN=kkt-test-bypass-local python tools/tieout.py --base http://localhost:8002 \
    --out /app/memory/qa/db_audit/gate/tieout_$DB.md > /app/memory/qa/db_audit/gate/tieout_$DB.log 2>&1
  echo "$DB exit $?" >> /app/memory/qa/db_audit/gate/tieout_runs.log
  kill $P; sleep 3
done
echo DONE >> /app/memory/qa/db_audit/gate/tieout_runs.log
