#!/bin/bash
# 3I final speed + memory sequence (heavy, sequential): Elite reports/budget without and with Redis, 20-min loads in
# both modes (Redis stopped 60 s at minute 10), then a 60-min soak without Redis.
cd /app/backend
L=/app/memory/qa/phase3i/final_runs.log
Q=/app/memory/qa/phase3i
B=/app/.eqtmp/bin
reap() { for p in $(pgrep -f multiprocessing-fork); do tr '\0' '\n' </proc/$p/environ 2>/dev/null | grep -q kkt_perf && kill $p; done; sleep 2; }
echo "=== start $(date -u +%T)" > $L
reap; python tools/perf_budget.py --source kkt_volume --runs 30 --workers 2 --cpus 0,1 --out $Q/perf_elite_budget.md >> $L 2>&1; echo "budget exit $?" >> $L
reap; python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --out $Q/perf_elite_reports.md >> $L 2>&1; echo "reports exit $?" >> $L
reap; LD_LIBRARY_PATH=$B $B/redis-server --port 6391 --save "" --appendonly no --daemonize yes --maxmemory 256mb --maxmemory-policy allkeys-lru >> $L 2>&1
REDIS_URL=redis://127.0.0.1:6391/0 python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --out $Q/perf_elite_reports_redis.md >> $L 2>&1; echo "reports+redis exit $?" >> $L
LD_LIBRARY_PATH=$B $B/redis-cli -p 6391 shutdown nosave >> $L 2>&1
reap; python tools/loadtest_3i.py --minutes 20 --out $Q/load_noredis.md >> $L 2>&1; echo "load noredis exit $?" >> $L
reap; python tools/loadtest_3i.py --redis --minutes 20 --out $Q/load_redis.md >> $L 2>&1; echo "load redis exit $?" >> $L
reap; python tools/loadtest_3i.py --minutes 60 --out $Q/soak_60.md >> $L 2>&1; echo "soak exit $?" >> $L
reap; python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --out $Q/perf_elite_reports.md >> $L 2>&1; echo "reports (rerun) exit $?" >> $L
reap; echo "DONE $(date -u +%T)" >> $L
