#!/bin/bash
# 3I close round 7: after close6 — equivalence ×3 and ONE full sequential pytest on the final code (Collections split scan).
cd /app/backend
Q=/app/memory/qa/phase3i; T=/app/.eqtmp; L=$Q/close7_runs.log; : > $L
until grep -q "CLOSE6 DONE" $Q/close6_runs.log 2>/dev/null; do sleep 20; done
echo "=== equivalence $(date -u +%T)" >> $L
cd /app && git worktree add -f .wt_old 4c6094e >> $L 2>&1; cp /app/backend/.env /app/.wt_old/backend/.env; cd /app/backend
cp tools/equiv_3i.py /app/.wt_old/backend/tools/equiv_3i.py
for d in kkt_medium kkt_volume test_database; do
  (cd /app/.wt_old/backend && taskset -c 8-11 timeout 1500 python tools/equiv_3i.py dump $d $T/old_$d.json > $T/old_$d.log 2>&1)
  (taskset -c 8-11 timeout 1500 python tools/equiv_3i.py dump $d $T/new_$d.json > $T/new_$d.log 2>&1)
  python tools/equiv_3i.py diff $T/old_$d.json $T/new_$d.json > $Q/equiv_$d.log 2>&1
  python tools/equiv_cancel_check.py $T/old_$d.json $T/new_$d.json > $Q/equiv_cancel_$d.log 2>&1
  rm -f $T/old_$d.json $T/new_$d.json
  echo "$d equiv: $(grep -E 'requests' $Q/equiv_$d.log | head -1) | $(tail -1 $Q/equiv_cancel_$d.log)" >> $L
done
cd /app && git worktree remove --force .wt_old >> $L 2>&1; cd /app/backend
pkill -f "port 8021"; sleep 3
echo "=== pytest $(date -u +%T)" >> $L
python -m pytest -q --no-header -p no:cacheprovider tests > $Q/pytest_full_3i_final.log 2>&1; echo "pytest exit $?" >> $L
tail -1 $Q/pytest_full_3i_final.log >> $L
echo "CLOSE7 DONE $(date -u +%T)" >> $L
