#!/bin/bash
# 3H gates on kkt_medium / kkt_volume through a private backend (:8002, no reload, demo refresh off).
cd /app/backend
set -a; . ./.env; set +a
O=/app/memory/qa/phase3i
: > $O/gate_runs.log
for DB in kkt_medium kkt_volume; do
  DB_NAME=$DB LOGIN_RATE_LIMIT_BYPASS_TOKEN=kkt-test-bypass-local KKT_ROLE=test BACKUP_ENABLED=0 DEMO_AUTO_REFRESH=false \
    nohup python -m uvicorn server:app --host 127.0.0.1 --port 8002 --log-level warning > /tmp/g3h_$DB.log 2>&1 &
  P=$!
  for i in $(seq 1 180); do curl -s localhost:8002/api/health | grep -q '"done":true' && break; sleep 1; done
  export DB_NAME=$DB LOGIN_RATE_LIMIT_BYPASS_TOKEN=kkt-test-bypass-local
  python tools/tieout.py --base http://localhost:8002 --out $O/tieout_$DB.md > $O/tieout_$DB.log 2>&1
  echo "$DB tieout exit $?" >> $O/gate_runs.log
  python tools/tieout_reports.py --base http://localhost:8002 > $O/tieout_reports_$DB.log 2>&1
  echo "$DB tieout_reports exit $?" >> $O/gate_runs.log
  python tools/asof_replay.py --base http://localhost:8002 --out $O/asof_replay_$DB.md > /dev/null 2>&1
  echo "$DB asof_replay exit $?" >> $O/gate_runs.log
  python tools/exports_3h.py --base http://localhost:8002 --out $O/exports_$DB.md > /dev/null 2>&1
  echo "$DB exports exit $?" >> $O/gate_runs.log
  kill $P; sleep 3
done
echo DONE >> $O/gate_runs.log
