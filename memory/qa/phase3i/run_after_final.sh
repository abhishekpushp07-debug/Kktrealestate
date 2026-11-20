#!/bin/bash
# 3I after the final pipeline: 3 consecutive 50-report runs on the final code (no Redis, no Redis, Redis),
# then background jobs at 1,500 bookings vs their windows + the two-server single-run proof. Nothing overlaps.
cd /app/backend
Q=/app/memory/qa/phase3i; L=$Q/final_pipeline.log
until grep -q "FINAL DONE" $L 2>/dev/null; do sleep 20; done
pkill -f "port 8021"; sleep 3
B=/usr/bin; [ -x $B/redis-server ] || B=/app/.eqtmp/bin
reap() {
  for p in $(pgrep -f multiprocessing-fork); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -qx DB_NAME=kkt_perf_scratch && kill -9 $p; done
  sleep 4
}
for n in 1 2; do
  echo "=== R reports no Redis run $n $(date -u +%T)" >> $L
  reap; python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --cold 10 --warm 30 --out $Q/perf_elite_reports_run$n.md >> $L 2>&1; echo "R reports run $n exit $?" >> $L
done
echo "=== R reports Redis run 3 $(date -u +%T)" >> $L
reap; LD_LIBRARY_PATH=$B $B/redis-server --port 6391 --save "" --appendonly no --daemonize yes --maxmemory 256mb --maxmemory-policy allkeys-lru >> $L 2>&1
REDIS_URL=redis://127.0.0.1:6391/0 python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --cold 10 --warm 30 --out $Q/perf_elite_reports_run3_redis.md >> $L 2>&1; echo "R reports run 3 (redis) exit $?" >> $L
LD_LIBRARY_PATH=$B $B/redis-cli -p 6391 shutdown nosave >> $L 2>&1
reap; mongosh --quiet --eval 'db.getSiblingDB("kkt_perf_scratch").dropDatabase()' >> $L 2>&1
echo "=== J job windows $(date -u +%T)" >> $L
set -a; . ./.env; set +a
python tools/job_windows_3i.py --source kkt_volume --out $Q/job_windows.md --minutes 6 >> $L 2>&1; echo "J job windows exit $?" >> $L
echo "AFTER FINAL DONE $(date -u +%T)" >> $L
