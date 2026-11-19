#!/bin/bash
# 3I close round 4 (root: headroom): equivalence ×3, Elite budget, 3 consecutive 50-report runs
# (no Redis ×2, Redis ×1), then ONE full sequential pytest — all on the final code. Heavy steps never overlap.
cd /app/backend
Q=/app/memory/qa/phase3i; T=/app/.eqtmp; L=$Q/close4_runs.log; : > $L
B=/usr/bin; [ -x $B/redis-server ] || B=/app/.eqtmp/bin
reap() {
  for p in $(pgrep -f multiprocessing-fork); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -qx DB_NAME=kkt_perf_scratch && kill -9 $p; done
  sleep 4
}
echo "=== equivalence $(date -u +%T)" >> $L
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
echo "=== elite budget $(date -u +%T)" >> $L
reap; python tools/perf_budget.py --source kkt_volume --runs 30 --workers 2 --cpus 0,1 --out $Q/perf_elite_budget.md >> $L 2>&1; echo "budget exit $?" >> $L
for n in 1 2; do
  echo "=== reports no Redis run $n $(date -u +%T)" >> $L
  reap; python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --cold 10 --warm 30 --out $Q/perf_elite_reports_run$n.md >> $L 2>&1; echo "reports run $n exit $?" >> $L
done
echo "=== reports Redis run 3 $(date -u +%T)" >> $L
reap; LD_LIBRARY_PATH=$B $B/redis-server --port 6391 --save "" --appendonly no --daemonize yes --maxmemory 256mb --maxmemory-policy allkeys-lru >> $L 2>&1
REDIS_URL=redis://127.0.0.1:6391/0 python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --cold 10 --warm 30 --out $Q/perf_elite_reports_run3_redis.md >> $L 2>&1; echo "reports run 3 (redis) exit $?" >> $L
LD_LIBRARY_PATH=$B $B/redis-cli -p 6391 shutdown nosave >> $L 2>&1
reap; mongosh --quiet --eval 'db.getSiblingDB("kkt_perf_scratch").dropDatabase()' >> $L 2>&1
echo "=== pytest $(date -u +%T)" >> $L
python -m pytest -q --no-header -p no:cacheprovider tests > $Q/pytest_full_3i_d.log 2>&1; echo "pytest exit $?" >> $L
tail -1 $Q/pytest_full_3i_d.log >> $L
echo "CLOSE4 DONE $(date -u +%T)" >> $L
