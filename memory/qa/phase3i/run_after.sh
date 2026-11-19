#!/bin/bash
# 3I after the loads: Redis command check (8 min, family learner on), Elite reports without Redis, full sequential pytest.
cd /app/backend
L=/app/memory/qa/phase3i/final_runs.log; Q=/app/memory/qa/phase3i
reap() { for p in $(pgrep -f multiprocessing-fork); do tr '\0' '\n' </proc/$p/environ 2>/dev/null | grep -q kkt_perf && kill $p; done; sleep 2; }
echo "=== after $(date -u +%T)" >> $L
reap; python tools/loadtest_3i.py --redis --minutes 8 --out $Q/load_redis_commands.md >> $L 2>&1; echo "redis commands exit $?" >> $L
reap; python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --out $Q/perf_elite_reports.md >> $L 2>&1; echo "reports exit $?" >> $L
reap; python tools/perf_budget.py --source kkt_volume --runs 30 --workers 2 --cpus 0,1 --out $Q/perf_elite_budget.md >> $L 2>&1; echo "budget exit $?" >> $L
reap; rm -f tests/.flat_claims.json; timeout 3000 python -m pytest -n 0 -q --no-header -p no:cacheprovider > $Q/pytest_full_3i.log 2>&1; echo "pytest exit $?" >> $Q/pytest_full_3i.log
echo "AFTER DONE $(date -u +%T)" >> $L
