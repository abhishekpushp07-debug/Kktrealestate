#!/bin/bash
# 3I loads, re-run with token refresh (access tokens last 15 min): Redis 20 min (stopped 60 s at minute 10), then a
# 60-min soak without Redis (its 10/20-min points are the no-Redis 20-min run).
cd /app/backend
L=/app/memory/qa/phase3i/final_runs.log; Q=/app/memory/qa/phase3i
reap() { for p in $(pgrep -f multiprocessing-fork); do tr '\0' '\n' </proc/$p/environ 2>/dev/null | grep -q kkt_perf && kill $p; done; sleep 2; }
echo "=== loads $(date -u +%T)" >> $L
reap; python tools/loadtest_3i.py --redis --minutes 20 --out $Q/load_redis.md >> $L 2>&1; echo "load redis exit $?" >> $L
reap; python tools/loadtest_3i.py --minutes 60 --out $Q/soak_60.md >> $L 2>&1; echo "soak exit $?" >> $L
reap; echo "LOADS DONE $(date -u +%T)" >> $L
