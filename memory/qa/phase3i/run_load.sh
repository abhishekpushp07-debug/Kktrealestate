#!/bin/bash
# 3I load tests: 20 min without Redis, then 20 min with local Redis (stopped 60 s at minute 10).
cd /app/backend
reap() { for p in $(pgrep -f multiprocessing-fork); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -qx DB_NAME=kkt_perf_scratch && kill -9 $p; done; sleep 4; }
reap; python tools/loadtest_3i.py --out /app/memory/qa/phase3i/load_noredis.md > /app/memory/qa/phase3i/load_noredis.log 2>&1
reap; python tools/loadtest_3i.py --redis --out /app/memory/qa/phase3i/load_redis.md > /app/memory/qa/phase3i/load_redis.log 2>&1
reap; echo LOADDONE > /app/memory/qa/phase3i/load_done
