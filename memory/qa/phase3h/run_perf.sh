#!/bin/bash
# 3H speed check (REQ-350): same Elite set-up as baseline_3g_elite.md — kkt_volume, 2 processes pinned to CPUs 0,1.
cd /app/backend
L=/app/memory/qa/phase3h/perf_runs.log; : > $L
echo "=== elite budget $(date -u +%T)" >> $L
reap() {  # orphaned uvicorn workers of the scratch server keep writing scheduler locks and break the next restore
  for p in $(pgrep -f multiprocessing-fork); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -qx DB_NAME=kkt_perf_scratch && kill $p; done
  sleep 2
}
reap
python tools/perf_budget.py --source kkt_volume --runs 30 --workers 2 --cpus 0,1 --out /app/memory/qa/phase3h/perf_elite_budget.md >> $L 2>&1; echo "exit $?" >> $L
reap
echo "=== elite reports $(date -u +%T)" >> $L
python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --cold 10 --warm 30 --out /app/memory/qa/phase3h/perf_elite_reports.md >> $L 2>&1; echo "exit $?" >> $L
echo "DONE $(date -u +%T)" >> $L
