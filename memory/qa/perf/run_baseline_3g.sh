#!/bin/bash
# 3G close-out perf: (1) write budgets on kkt_volume, same config as the pre-3G run phase3e_volume.md (1 process, no cap, 20 runs)
# (2) JRN-140 Elite baseline: kkt_volume, 2 backend processes pinned to CPUs 0,1 — hot reads + writes + all 50 reports
cd /app/backend
L=/app/memory/qa/perf/baseline_3g_runs.log; : > $L
echo "=== writes-1p $(date -u +%T)" >> $L
python tools/perf_budget.py --source kkt_volume --runs 20 --out /app/memory/qa/perf/phase3g_volume.md >> $L 2>&1; echo "exit $?" >> $L
echo "=== elite budget $(date -u +%T)" >> $L
python tools/perf_budget.py --source kkt_volume --runs 30 --workers 2 --cpus 0,1 --out /app/memory/qa/perf/baseline_3g_elite_budget.md >> $L 2>&1; echo "exit $?" >> $L
echo "=== elite reports $(date -u +%T)" >> $L
python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --cold 10 --warm 30 --out /app/memory/qa/perf/baseline_3g_elite_reports.md >> $L 2>&1; echo "exit $?" >> $L
echo "DONE $(date -u +%T)" >> $L
