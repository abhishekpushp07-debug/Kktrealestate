#!/bin/bash
# 3F carry-over (c): phone sweep → click-through → volume tieout, one heavy job at a time.
URL=$(grep REACT_APP_BACKEND_URL /app/frontend/.env | cut -d '=' -f2)
PW=$(grep ^DEMO_PASSWORD /app/backend/.env | cut -d= -f2 | tr -d '"')
OUT=/app/memory/qa/carryover_3f.log
: > $OUT
cd /app/frontend/scripts && KKT_DEMO_PASSWORD=$PW timeout 1500 python3 phone_sweep.py "$URL" 2>&1 | tail -2 >> $OUT
echo "phone EXIT $?" >> $OUT
cd /app/tests_e2e/clickthrough && timeout 1200 python -m pytest -q -p no:cacheprovider 2>&1 | tail -1 >> $OUT
cd /app/backend
DB_NAME=kkt_volume LOGIN_RATE_LIMIT_BYPASS_TOKEN=kkt-test-bypass-local nohup python -m uvicorn server:app --host 127.0.0.1 --port 8051 > /app/memory/qa/vol_8051.log 2>&1 &
for i in $(seq 1 60); do curl -s -m 2 -o /dev/null localhost:8051/api/health && break; sleep 2; done
sleep 30
DB_NAME=kkt_volume timeout 600 python tools/tieout.py --base http://127.0.0.1:8051 --out /app/memory/qa/tieout_3f_volume.md 2>&1 | grep -E "FAIL|failed" | tail -5 >> $OUT
pkill -f "port 8051"
echo DONE >> $OUT
