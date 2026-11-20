#!/bin/bash
Q=/app/memory/qa/phase3i; L=$Q/both_suites.log
echo "=== both suites $(date -u +%T) $(git -C /app rev-parse --short HEAD)" > $L
( bash $Q/run_replset.sh; echo "REPLSET: $(tail -1 $Q/pytest_replset.log)" >> $L ) &
( cd /app/backend && timeout 3600 python -m pytest tests -v -p no:cacheprovider --tb=line -rfE > $Q/pytest_full_3i_final5.log 2>&1; echo "STANDALONE exit $?: $(tail -1 $Q/pytest_full_3i_final5.log)" >> $L ) &
wait
echo "BOTH DONE $(date -u +%T)" >> $L
