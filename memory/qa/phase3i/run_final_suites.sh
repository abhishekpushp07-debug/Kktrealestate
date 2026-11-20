#!/bin/bash
Q=/app/memory/qa/phase3i; L=$Q/final_suites.log; : > $L
echo "=== replset $(date -u +%T) $(git -C /app rev-parse --short HEAD)" >> $L
bash $Q/run_replset.sh; tail -1 $Q/pytest_replset.log >> $L
pkill -f "port 80[34]1"; sleep 3
echo "=== pytest $(date -u +%T)" >> $L
cd /app/backend && timeout 3600 python -m pytest tests -q -p no:cacheprovider > $Q/pytest_full_3i_final5.log 2>&1; echo "pytest exit $?" >> $L; tail -1 $Q/pytest_full_3i_final5.log >> $L
echo "DONE $(date -u +%T)" >> $L
