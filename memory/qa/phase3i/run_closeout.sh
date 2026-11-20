#!/bin/bash
# 3I CLOSE-OUT pipeline on the final code — strictly one heavy run at a time, resumable:
# every finished step writes "DONE <step>" to closing_final.state; a relaunch skips it.
# Usage: setsid nohup bash run_closeout.sh > /dev/null 2>&1 < /dev/null &
cd /app/backend
Q=/app/memory/qa/phase3i; T=/app/.eqtmp; S=$Q/closing_final.state; L=$Q/closeout.log
touch $S; mkdir -p /tmp/eq
B=/usr/bin; [ -x $B/redis-server ] || B=/app/.eqtmp/bin
export LD_LIBRARY_PATH=/app/.eqtmp/bin${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
log() { echo "$(date -u +%FT%T) $* · df=$(df --output=avail -h / | tail -1 | tr -d ' ') · $(git -C /app rev-parse --short HEAD)" >> $L; }
done_() { grep -qx "DONE $1" $S; }
mark() { echo "DONE $1" >> $S; log "done $1"; }
reap() {
  pkill -f "port 80[34]1"; pkill -f "port 8077"; pkill -f "port 810[12]"; pkill -f "port 8002"
  for p in $(pgrep -f "multiprocessing-fork|spawn_main"); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -qE "^DB_NAME=(kkt_perf_scratch|kkt_audit_scratch)$" && kill -9 $p; done
  sleep 4; rm -rf /tmp/pytest-of-root /tmp/tmp*.zip 2>/dev/null
}
redis_up() { $B/redis-server --port ${1:-6391} --save "" --appendonly no --daemonize yes --maxmemory 256mb --maxmemory-policy allkeys-lru >> $L 2>&1; }
redis_down() { $B/redis-cli -p ${1:-6391} shutdown nosave >> $L 2>&1; }
log "=== closeout start"

step() { done_ $1 && return 1; log "start $1"; reap; return 0; }

if step budget; then
  python tools/perf_budget.py --source kkt_volume --runs 30 --workers 2 --cpus 0,1 --out $Q/perf_elite_budget_final.md > $Q/perf_elite_budget_final.log 2>&1 && mark budget
fi
if step budget_redis; then
  redis_up 6391
  REDIS_URL=redis://127.0.0.1:6391/0 python tools/perf_budget.py --source kkt_volume --runs 30 --workers 2 --cpus 0,1 --out $Q/perf_elite_budget_final_redis.md > $Q/perf_elite_budget_final_redis.log 2>&1 && mark budget_redis
  redis_down 6391
fi
for n in 1 2; do
  if step reports$n; then
    python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --cold 10 --warm 30 --out $Q/perf_elite_reports_final$n.md > $Q/perf_elite_reports_final$n.log 2>&1 && mark reports$n
  fi
done
if step reports3_redis; then
  redis_up 6391
  REDIS_URL=redis://127.0.0.1:6391/0 python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --cold 10 --warm 30 --out $Q/perf_elite_reports_final3_redis.md > $Q/perf_elite_reports_final3_redis.log 2>&1 && mark reports3_redis
  redis_down 6391
fi
mongosh --quiet --eval 'db.getSiblingDB("kkt_perf_scratch").dropDatabase()' > /dev/null 2>&1

# equivalence: the 3I code before the close-out (HEAD~1, itself proven equal to 3H: 411 × 3 DBs) vs the final code
if step equiv; then
  OLD=$(cat $Q/closeout_base_sha)
  cd /app && git worktree remove --force .wt_old > /dev/null 2>&1; git worktree add -f .wt_old $OLD >> $L 2>&1
  cp /app/backend/.env /app/.wt_old/backend/.env; cp /app/backend/tools/equiv_3i.py /app/.wt_old/backend/tools/equiv_3i.py; cd /app/backend
  ok=1
  for d in kkt_medium kkt_volume test_database; do
    (cd /app/.wt_old/backend && timeout 1800 python tools/equiv_3i.py dump $d $T/old_$d.json > $T/old_$d.log 2>&1)
    (timeout 1800 python tools/equiv_3i.py dump $d $T/new_$d.json > $T/new_$d.log 2>&1)
    python tools/equiv_3i.py diff $T/old_$d.json $T/new_$d.json > $Q/equiv_final_$d.log 2>&1 || ok=0
    rm -f $T/old_$d.json $T/new_$d.json
    log "equiv $d: $(tail -2 $Q/equiv_final_$d.log | tr '\n' ' ')"
  done
  cd /app && git worktree remove --force .wt_old >> $L 2>&1; cd /app/backend
  mark equiv
fi

if step gates_preview; then
  bash $Q/run_preview_gates.sh; cat $Q/preview_gate_runs.log >> $L; mark gates_preview
fi
if step gates_mv; then
  bash $Q/run_gates.sh; cat $Q/gate_runs.log >> $L; mark gates_mv
fi

# drills, standalone mode (no Redis + local Redis): races 20 reps, stale 10 × 3 actions, engagement 10 reps
drill() {  # drill <state-name> <args…>
  local n=$1; shift
  if step $n; then
    python -m tools.db_audit_drills setup >> $Q/drills_final.log 2>&1 && \
      python -m tools.db_audit_drills "$@" >> $Q/drills_final.log 2>&1; echo "--- $n exit $? $(date -u +%T)" >> $Q/drills_final.log
    mark $n
  fi
}
redis_up 6390
drill d_races races --label final --reps 20
drill d_races_redis races --label final --reps 20 --redis redis://127.0.0.1:6390/0
drill d_stale stale --label final --reps 10
$B/redis-cli -p 6390 flushall > /dev/null 2>&1
drill d_stale_redis stale --label final --reps 10 --redis redis://127.0.0.1:6390/0
drill d_engagement engagement --label final --reps 10
drill d_engagement_redis engagement --label final --reps 10 --redis redis://127.0.0.1:6390/0
python -m tools.db_audit_drills teardown >> $Q/drills_final.log 2>&1

# drills, replica-set mode (multi-document transactions, KKT_TXN_STRICT=1)
P=27019; D=/tmp/kkt_rs_drill
rsd_up() {
  mongosh --port $P --quiet --eval 'db.hello().isWritablePrimary' 2>/dev/null | grep -q true && return 0
  rm -rf $D; mkdir -p $D
  mongod --replSet rsd --port $P --dbpath $D --bind_ip 127.0.0.1 --fork --logpath $D/mongod.log >> $L 2>&1
  mongosh --port $P --quiet --eval 'rs.initiate({_id:"rsd",members:[{_id:0,host:"127.0.0.1:'$P'"}]})' >> $L 2>&1
  for i in $(seq 1 30); do mongosh --port $P --quiet --eval 'db.hello().isWritablePrimary' 2>/dev/null | grep -q true && break; sleep 1; done
  mongodump --uri=mongodb://localhost:27017 --db=kkt_volume --archive --quiet | mongorestore --uri="mongodb://127.0.0.1:$P/?replicaSet=rsd" --archive --quiet >> $L 2>&1
}
if ! (done_ r_races && done_ r_races_redis && done_ r_stale && done_ r_stale_redis && done_ r_engagement && done_ r_engagement_redis); then
  rsd_up
  export MONGO_URL_SAVED=$MONGO_URL
  export MONGO_URL="mongodb://127.0.0.1:$P/?replicaSet=rsd" KKT_TXN_STRICT=1
  drill r_races races --label final_rs --reps 20
  drill r_races_redis races --label final_rs --reps 20 --redis redis://127.0.0.1:6390/0
  drill r_stale stale --label final_rs --reps 10
  $B/redis-cli -p 6390 flushall > /dev/null 2>&1
  drill r_stale_redis stale --label final_rs --reps 10 --redis redis://127.0.0.1:6390/0
  drill r_engagement engagement --label final_rs --reps 10
  drill r_engagement_redis engagement --label final_rs --reps 10 --redis redis://127.0.0.1:6390/0
  python -m tools.db_audit_drills teardown >> $Q/drills_final.log 2>&1
  if [ -n "$MONGO_URL_SAVED" ]; then export MONGO_URL=$MONGO_URL_SAVED; else unset MONGO_URL; fi; unset KKT_TXN_STRICT
  mongosh --port $P --quiet --eval 'db.adminCommand({shutdown:1})' > /dev/null 2>&1; sleep 2; rm -rf $D
fi
redis_down 6390

# full suite, both modes (chunked + resumable; run_chunks.sh skips finished chunks of the same commit)
if step suite_sa; then
  bash $Q/run_chunks.sh sa; grep -h "chunk" $Q/chunks_sa/driver.log | tail -12 >> $L; mark suite_sa
fi
if step suite_rs; then
  bash $Q/run_chunks.sh rs; grep -h "chunk" $Q/chunks_rs/driver.log | tail -12 >> $L
  mongosh --port 27018 --quiet --eval 'db.adminCommand({shutdown:1})' > /dev/null 2>&1; sleep 2; rm -rf /tmp/kkt_rs0
  mark suite_rs
fi
if step frontend; then
  (cd /app/frontend && yarn -s lint > $Q/fe_lint_final.log 2>&1; echo "lint exit $?" >> $Q/fe_lint_final.log
   GENERATE_SOURCEMAP=false NODE_OPTIONS=--max-old-space-size=2048 node scripts/dev.js --build-only > $Q/fe_build_final.log 2>&1; echo "build exit $?" >> $Q/fe_build_final.log)
  tail -1 $Q/fe_lint_final.log >> $L; tail -1 $Q/fe_build_final.log >> $L; mark frontend
fi
reap
log "=== CLOSEOUT DONE"
