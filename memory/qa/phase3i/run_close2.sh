#!/bin/bash
# 3I close round 3 (root notes 1-6): everything re-run in sequence on the final code. Heavy suites never overlap.
cd /app/backend
Q=/app/memory/qa/phase3i; T=/app/.eqtmp; L=$Q/close2_runs.log; : > $L
B=/usr/bin; [ -x $B/redis-server ] || B=/app/.eqtmp/bin
reap() {
  for p in $(pgrep -f multiprocessing-fork); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -qx DB_NAME=kkt_perf_scratch && kill -9 $p; done
  sleep 4
}
echo "=== equivalence $(date -u +%T)" >> $L
cd /app && git worktree add -f .wt_old 4c6094e >> $L 2>&1; cp /app/backend/.env /app/.wt_old/backend/.env; cd /app/backend
cp tools/equiv_3i.py /app/.wt_old/backend/tools/equiv_3i.py  # the tool imports the app beside itself → old code
for d in kkt_medium kkt_volume test_database; do
  (cd /app/.wt_old/backend && taskset -c 8-11 timeout 1500 python tools/equiv_3i.py dump $d $T/old_$d.json > $T/old_$d.log 2>&1)
  (taskset -c 8-11 timeout 1500 python tools/equiv_3i.py dump $d $T/new_$d.json > $T/new_$d.log 2>&1)
  python tools/equiv_3i.py diff $T/old_$d.json $T/new_$d.json > $Q/equiv_$d.log 2>&1
  python tools/equiv_cancel_check.py $T/old_$d.json $T/new_$d.json > $Q/equiv_cancel_$d.log 2>&1
  rm -f $T/old_$d.json $T/new_$d.json
  echo "$d equiv: $(grep -E 'requests' $Q/equiv_$d.log | head -1) | $(tail -1 $Q/equiv_cancel_$d.log)" >> $L
done
cd /app && git worktree remove --force .wt_old >> $L 2>&1; cd /app/backend
echo "=== elite budget $(date -u +%T)" >> $L
reap; python tools/perf_budget.py --source kkt_volume --runs 30 --workers 2 --cpus 0,1 --out $Q/perf_elite_budget.md >> $L 2>&1; echo "budget exit $?" >> $L
reap; python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --cold 10 --warm 30 --out $Q/perf_elite_reports.md >> $L 2>&1; echo "reports exit $?" >> $L
reap; LD_LIBRARY_PATH=$B $B/redis-server --port 6391 --save "" --appendonly no --daemonize yes --maxmemory 256mb --maxmemory-policy allkeys-lru >> $L 2>&1
REDIS_URL=redis://127.0.0.1:6391/0 python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --cold 10 --warm 30 --out $Q/perf_elite_reports_redis.md >> $L 2>&1; echo "reports+redis exit $?" >> $L
LD_LIBRARY_PATH=$B $B/redis-cli -p 6391 shutdown nosave >> $L 2>&1
echo "=== loads $(date -u +%T)" >> $L
reap; python tools/loadtest_3i.py --redis --minutes 20 --out $Q/load_redis.md >> $L 2>&1; echo "load redis exit $?" >> $L
reap; python tools/loadtest_3i.py --minutes 20 --out $Q/load_noredis.md >> $L 2>&1; echo "load noredis exit $?" >> $L
reap; mongosh --quiet --eval 'db.getSiblingDB("kkt_perf_scratch").dropDatabase()' >> $L 2>&1
echo "=== pytest $(date -u +%T)" >> $L
python -m pytest -q --no-header -p no:cacheprovider tests > $Q/pytest_full_3i_c.log 2>&1; echo "pytest exit $?" >> $L
tail -1 $Q/pytest_full_3i_c.log >> $L
echo "=== gates $(date -u +%T)" >> $L
bash $Q/run_gates.sh; echo "gates exit $?" >> $L
echo "CLOSE2 DONE $(date -u +%T)" >> $L
