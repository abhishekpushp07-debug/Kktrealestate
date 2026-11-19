#!/bin/bash
# 3I close round 5: after the Redis write left the request path — 3 consecutive 50-report Elite runs
# (no Redis, no Redis, Redis) and ONE full sequential pytest on the final code.
cd /app/backend
Q=/app/memory/qa/phase3i; L=$Q/close5_runs.log; : > $L
until grep -q "CLOSE4 DONE" $Q/close4_runs.log 2>/dev/null; do sleep 20; done
B=/usr/bin; [ -x $B/redis-server ] || B=/app/.eqtmp/bin
reap() {
  for p in $(pgrep -f multiprocessing-fork); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -qx DB_NAME=kkt_perf_scratch && kill -9 $p; done
  sleep 4
}
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
python -m pytest -q --no-header -p no:cacheprovider tests > $Q/pytest_full_3i_e.log 2>&1; echo "pytest exit $?" >> $L
tail -1 $Q/pytest_full_3i_e.log >> $L
echo "CLOSE5 DONE $(date -u +%T)" >> $L
