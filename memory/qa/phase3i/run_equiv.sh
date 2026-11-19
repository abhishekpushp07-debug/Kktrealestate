#!/bin/bash
# 3I same figures: dump on HEAD (old code, worktree) and on the working tree, then diff. Usage: run_equiv.sh DB
O=/app/memory/qa/phase3i; DB=$1
(cd /app/.wt_old/backend && python tools/equiv_3i.py dump $DB /app/.eqtmp/eq_old_$DB.json) > $O/equiv_$DB.log 2>&1
(cd /app/backend && python tools/equiv_3i.py dump $DB /app/.eqtmp/eq_new_$DB.json) >> $O/equiv_$DB.log 2>&1
(cd /app/backend && python tools/equiv_3i.py diff /app/.eqtmp/eq_old_$DB.json /app/.eqtmp/eq_new_$DB.json) >> $O/equiv_$DB.log 2>&1
echo "exit $?" >> $O/equiv_$DB.log
