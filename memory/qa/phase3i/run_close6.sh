#!/bin/bash
# 3I close round 6: 3 consecutive 50-report Elite runs (no Redis, no Redis, Redis) on a clean box, after close5's pytest.
cd /app/backend
Q=/app/memory/qa/phase3i; L=$Q/close6_runs.log; : > $L
until grep -q "CLOSE5 DONE" $Q/close5_runs.log 2>/dev/null; do sleep 20; done
sleep 10; pkill -f "port 8021" ; sleep 3  # no test backend left beside the measured servers
B=/usr/bin; [ -x $B/redis-server ] || B=/app/.eqtmp/bin
reap() {
  for p in $(pgrep -f multiprocessing-fork); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -qx DB_NAME=kkt_perf_scratch && kill -9 $p; done
  sleep 4
}
echo "box: $(pgrep -af uvicorn | grep -v plugins | wc -l) uvicorn (supervisor preview only)" >> $L
for n in 1 2; do
  echo "=== reports no Redis run $n $(date -u +%T)" >> $L
  reap; python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --cold 10 --warm 30 --out $Q/perf_elite_reports_run$n.md >> $L 2>&1; echo "reports run $n exit $?" >> $L
done
echo "=== reports Redis run 3 $(date -u +%T)" >> $L
reap; LD_LIBRARY_PATH=$B $B/redis-server --port 6391 --save "" --appendonly no --daemonize yes --maxmemory 256mb --maxmemory-policy allkeys-lru >> $L 2>&1
REDIS_URL=redis://127.0.0.1:6391/0 python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --cold 10 --warm 30 --out $Q/perf_elite_reports_run3_redis.md >> $L 2>&1; echo "reports run 3 (redis) exit $?" >> $L
LD_LIBRARY_PATH=$B $B/redis-cli -p 6391 shutdown nosave >> $L 2>&1
reap; mongosh --quiet --eval 'db.getSiblingDB("kkt_perf_scratch").dropDatabase()' >> $L 2>&1
echo "CLOSE6 DONE $(date -u +%T)" >> $L
