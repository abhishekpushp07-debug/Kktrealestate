#!/bin/bash
# 3I closing pipeline; each step records DONE so a pod restart resumes at the next step
Q=/app/memory/qa/phase3i; L=$Q/closing.log; S=$Q/closing.state; touch $S
cd /app/backend
B=/usr/bin; [ -x $B/redis-server ] || B=/app/.eqtmp/bin
reap() { pkill -f "port 80[34]1"; pkill -f "port 8077"; for p in $(pgrep -f "multiprocessing-fork|spawn_main"); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -qx DB_NAME=kkt_perf_scratch && kill -9 $p; done; sleep 3; mongosh --quiet --eval 'db.getSiblingDB("kkt_perf_scratch").dropDatabase()' >/dev/null 2>&1; }
step() { grep -qx "$1" $S && return 1; echo "=== $1 $(date -u +%T) $(git -C /app rev-parse --short HEAD) df=$(df --output=avail -h /app | tail -1)" >> $L; return 0; }
done_() { echo "$1" >> $S; }
for n in 1 2; do step reports$n && { reap; python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --cold 10 --warm 30 --out $Q/perf_elite_reports_run$n.md >> $L 2>&1; echo "exit $?" >> $L; done_ reports$n; }; done
step reports3 && { reap; LD_LIBRARY_PATH=$B $B/redis-server --port 6391 --save "" --appendonly no --daemonize yes --maxmemory 256mb --maxmemory-policy allkeys-lru >> $L 2>&1
  REDIS_URL=redis://127.0.0.1:6391/0 python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --cold 10 --warm 30 --out $Q/perf_elite_reports_run3b_redis.md >> $L 2>&1; echo "exit $?" >> $L
  LD_LIBRARY_PATH=$B $B/redis-cli -p 6391 shutdown nosave >> $L 2>&1; done_ reports3; }
for n in 1 2 3; do step budget$n && { reap; python tools/perf_budget.py --source kkt_volume --runs 30 --workers 2 --cpus 0,1 --out $Q/perf_elite_budget_run$n.md > $Q/budget_run$n.log 2>&1; echo "exit $?" >> $L; grep -E "^\| (write|after_save)|Bills raised page \||month\) \|" $Q/perf_elite_budget_run$n.md | awk -F'|' '{print $3,"|",$5,$6,$7,"|",$(NF-1)}' >> $L; done_ budget$n; }; done
reap
step replset && { bash $Q/run_replset.sh; tail -1 $Q/pytest_replset.log >> $L; reap; done_ replset; }
step pytest && { pkill -f "port 8021"; sleep 3; timeout 3600 python -m pytest tests -q -p no:cacheprovider > $Q/pytest_full_3i_final5.log 2>&1; echo "pytest exit $?" >> $L; tail -1 $Q/pytest_full_3i_final5.log >> $L; done_ pytest; }
echo "ALL DONE $(date -u +%T)" >> $L
