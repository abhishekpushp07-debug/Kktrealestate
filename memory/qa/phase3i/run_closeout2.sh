#!/bin/bash
# 3I close-out pass 2: after pass 1 ends, re-run the steps that ran before the last fixes (dashboard new-day refresh,
# Advances other-charge advance, whole-rupee GST credit) on the final code; every other step stays DONE.
Q=/app/memory/qa/phase3i
while pgrep -f "bash run_closeout.sh" > /dev/null; do sleep 20; done
sed -i -E '/^DONE (budget|budget_redis|equiv|gates_preview|gates_mv)$/d' $Q/closing_final.state
echo "$(date -u +%FT%T) === pass 2 (re-run budget, equivalence, gates on the final code)" >> $Q/closeout.log
cd $Q && bash run_closeout.sh
