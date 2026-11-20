#!/bin/bash
# 3I close: after the full suite — Redis-mode Elite reports, then tie-out / As-of / exports gates. Sequential.
cd /app/backend
Q=/app/memory/qa/phase3i; L=$Q/final_runs.log
until grep -q "pytest exit" $Q/pytest_full_3i_b.log 2>/dev/null; do sleep 20; done
B=/usr/bin; [ -x $B/redis-server ] || B=/app/.eqtmp/bin
reap() {
  for p in $(pgrep -f multiprocessing-fork); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -qx DB_NAME=kkt_perf_scratch && kill -9 $p; done
  sleep 4
}
echo "=== close $(date -u +%T)" >> $L
reap; LD_LIBRARY_PATH=$B $B/redis-server --port 6391 --save "" --appendonly no --daemonize yes --maxmemory 256mb --maxmemory-policy allkeys-lru >> $L 2>&1
REDIS_URL=redis://127.0.0.1:6391/0 python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --out $Q/perf_elite_reports_redis.md >> $L 2>&1; echo "reports+redis exit $?" >> $L
LD_LIBRARY_PATH=$B $B/redis-cli -p 6391 shutdown nosave >> $L 2>&1
reap; mongosh --quiet --eval 'db.getSiblingDB("kkt_perf_scratch").dropDatabase()' >> $L 2>&1
bash $Q/run_gates.sh; echo "gates exit $?" >> $L
echo "CLOSE DONE $(date -u +%T)" >> $L
