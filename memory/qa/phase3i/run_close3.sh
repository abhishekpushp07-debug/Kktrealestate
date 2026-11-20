#!/bin/bash
# 3I close round 3b: after run_close2 — Outstanding read beside Customer status changed after the perf/equivalence
# stage, so equivalence ×3 and both Elite report runs are repeated on the final code.
cd /app/backend
Q=/app/memory/qa/phase3i; T=/app/.eqtmp; L=$Q/close2_runs.log
until grep -q "CLOSE2 DONE" $L 2>/dev/null; do sleep 30; done
B=/usr/bin; [ -x $B/redis-server ] || B=/app/.eqtmp/bin
reap() {
  for p in $(pgrep -f multiprocessing-fork); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -qx DB_NAME=kkt_perf_scratch && kill -9 $p; done
  sleep 4
}
echo "=== 3b equivalence $(date -u +%T)" >> $L
cd /app && git worktree add -f .wt_old 4c6094e >> $L 2>&1; cp /app/backend/.env /app/.wt_old/backend/.env; cd /app/backend
cp tools/equiv_3i.py /app/.wt_old/backend/tools/equiv_3i.py
for d in kkt_medium kkt_volume test_database; do
  (cd /app/.wt_old/backend && taskset -c 8-11 timeout 1500 python tools/equiv_3i.py dump $d $T/old_$d.json > $T/old_$d.log 2>&1)
  (taskset -c 8-11 timeout 1500 python tools/equiv_3i.py dump $d $T/new_$d.json > $T/new_$d.log 2>&1)
  python tools/equiv_3i.py diff $T/old_$d.json $T/new_$d.json > $Q/equiv_$d.log 2>&1
  python tools/equiv_cancel_check.py $T/old_$d.json $T/new_$d.json > $Q/equiv_cancel_$d.log 2>&1
  rm -f $T/old_$d.json $T/new_$d.json
  echo "$d equiv: $(grep -E 'requests' $Q/equiv_$d.log | head -1) | $(tail -1 $Q/equiv_cancel_$d.log)" >> $L
done
cd /app && git worktree remove --force .wt_old >> $L 2>&1; cd /app/backend
echo "=== 3b elite reports $(date -u +%T)" >> $L
reap; python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --cold 10 --warm 30 --out $Q/perf_elite_reports.md >> $L 2>&1; echo "reports exit $?" >> $L
reap; LD_LIBRARY_PATH=$B $B/redis-server --port 6391 --save "" --appendonly no --daemonize yes --maxmemory 256mb --maxmemory-policy allkeys-lru >> $L 2>&1
REDIS_URL=redis://127.0.0.1:6391/0 python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --cold 10 --warm 30 --out $Q/perf_elite_reports_redis.md >> $L 2>&1; echo "reports+redis exit $?" >> $L
LD_LIBRARY_PATH=$B $B/redis-cli -p 6391 shutdown nosave >> $L 2>&1
reap; mongosh --quiet --eval 'db.getSiblingDB("kkt_perf_scratch").dropDatabase()' >> $L 2>&1
echo "CLOSE3 DONE $(date -u +%T)" >> $L
