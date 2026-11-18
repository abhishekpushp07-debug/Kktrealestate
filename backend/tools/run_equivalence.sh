#!/bin/bash
# REQ-211 proof: old code (git rev $1) vs working tree, each on a fresh copy of kkt_volume. Log: memory/qa/perf/equivalence.log
set -u
REV=$1; BLOCK=$2; STAGE=$3
LOG=/app/memory/qa/perf/equivalence.log
cd /app/backend
URL=$(grep ^MONGO_URL .env | cut -d= -f2- | tr -d '"')
: > $LOG
rm -rf /tmp/eqold && git -C /app worktree add -q -f /tmp/eqold "$REV" && cp .env /tmp/eqold/backend/.env
run() {  # dir db port out
  mongodump --uri "$URL" --db kkt_volume --archive --quiet | mongorestore --uri "$URL" --archive --drop --quiet --nsFrom='kkt_volume.*' --nsTo="$2.*"
  (cd $1 && DB_NAME=$2 LOGIN_RATE_LIMIT_BYPASS_TOKEN=kkt-test-bypass-local SEEDER_AS_OF_ENABLED=false python -m uvicorn server:app --host 127.0.0.1 --port $3 > /tmp/eq_$3.log 2>&1 &)
  for i in $(seq 1 90); do curl -s -m 2 -o /dev/null localhost:$3/api/health && break; sleep 2; done
  sleep 25
  python tools/perf_equivalence.py dump --base http://127.0.0.1:$3 --db $2 --block $BLOCK --stage $STAGE --out $4 >> $LOG 2>&1
  pkill -f "port $3"
}
run /tmp/eqold/backend kkt_eq_a 8041 /tmp/eq_old.json
run /app/backend kkt_eq_b 8042 /tmp/eq_new.json
python tools/perf_equivalence.py diff /tmp/eq_old.json /tmp/eq_new.json >> $LOG 2>&1
echo "DIFF EXIT $?" >> $LOG
git -C /app worktree remove --force /tmp/eqold
python - <<'EOF'
import os
from pymongo import MongoClient
c = MongoClient(os.environ.get("MONGO_URL") or open("/app/backend/.env").read().split("MONGO_URL=")[1].split()[0].strip('"'))
for d in ("kkt_eq_a", "kkt_eq_b"):
    c.drop_database(d)
EOF
echo DONE >> $LOG
