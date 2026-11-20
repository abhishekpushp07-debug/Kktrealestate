#!/bin/bash
# 3I FINAL pipeline on the final code (nothing else runs beside it):
# 3 consecutive 50-report Elite runs (no Redis, no Redis, Redis) → Elite budget → equivalence ×3 → ONE full pytest.
cd /app/backend
Q=/app/memory/qa/phase3i; T=/app/.eqtmp; L=$Q/final_perf5.log; : > $L
while pgrep -f run_perf4.sh | grep -qv $$; do sleep 15; done
B=/usr/bin; [ -x $B/redis-server ] || B=/app/.eqtmp/bin
reap() {
  pkill -f "port 80[34]1"; pkill -f "port 8077"
  for p in $(pgrep -f "multiprocessing-fork|spawn_main"); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -qx DB_NAME=kkt_perf_scratch && kill -9 $p; done
  sleep 4
}
echo "commit-less tree: $(git -C /app rev-parse --short HEAD) + working changes · start $(date -u +%T)" >> $L
for n in 1 2; do
  echo "=== reports no Redis run $n $(date -u +%T)" >> $L
  reap; python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --cold 10 --warm 30 --out $Q/perf_elite_reports_run$n.md >> $L 2>&1; echo "reports run $n exit $?" >> $L
done
echo "=== reports Redis run 3 $(date -u +%T)" >> $L
reap; LD_LIBRARY_PATH=$B $B/redis-server --port 6391 --save "" --appendonly no --daemonize yes --maxmemory 256mb --maxmemory-policy allkeys-lru >> $L 2>&1
REDIS_URL=redis://127.0.0.1:6391/0 python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --cold 10 --warm 30 --out $Q/perf_elite_reports_run3b_redis.md >> $L 2>&1; echo "reports run 3 (redis) exit $?" >> $L
LD_LIBRARY_PATH=$B $B/redis-cli -p 6391 shutdown nosave >> $L 2>&1
echo "=== elite budget $(date -u +%T)" >> $L
reap; python tools/perf_budget.py --source kkt_volume --runs 30 --workers 2 --cpus 0,1 --out $Q/perf_elite_budget_b.md >> $L 2>&1; echo "budget exit $?" >> $L
reap; mongosh --quiet --eval 'db.getSiblingDB("kkt_perf_scratch").dropDatabase()' >> $L 2>&1
echo "=== replset $(date -u +%T)" >> $L
bash -x $Q/run_replset.sh > $Q/replset_trace.log 2>&1; tail -1 $Q/pytest_replset.log >> $L
reap
echo "=== pytest $(date -u +%T)" >> $L
pkill -f "port 8021"; sleep 3
timeout 3600 python -m pytest tests -q -p no:cacheprovider > $Q/pytest_full_3i_final4.log 2>&1; echo "pytest exit $?" >> $L
tail -1 $Q/pytest_full_3i_final4.log >> $L
echo "PERF5 DONE $(date -u +%T)" >> $L
