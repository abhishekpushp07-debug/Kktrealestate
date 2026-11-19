#!/bin/bash
# 3I equivalence (read-only): 3H code (.wt_old @4c6094e) vs current, 411 requests per DB incl. past As-of dates.
Q=/app/memory/qa/phase3i; T=/app/.eqtmp
for d in kkt_medium kkt_volume test_database; do
  (cd /app/.wt_old/backend && taskset -c 8-11 timeout 1500 python tools/equiv_3i.py dump $d $T/old_$d.json > $T/old_$d.log 2>&1)
  (cd /app/backend && taskset -c 8-11 timeout 1500 python tools/equiv_3i.py dump $d $T/new_$d.json > $T/new_$d.log 2>&1)
  (cd /app/backend && python tools/equiv_3i.py diff $T/old_$d.json $T/new_$d.json > $Q/equiv_$d.log 2>&1)
  :
done
echo EQUIV DONE > $T/equiv_done
