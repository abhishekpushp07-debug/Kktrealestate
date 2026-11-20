#!/bin/bash
# 3I close-out v2: both suites on the final code, one after the other, resumable (closing_final.state).
# Usage: setsid nohup bash run_suites2.sh > /dev/null 2>&1 < /dev/null &
Q=/app/memory/qa/phase3i; S=$Q/closing_final.state; L=$Q/closeout.log
log() { echo "$(date -u +%FT%T) $* · mem=$(( $(cat /sys/fs/cgroup/memory.current) / 1048576 ))MB · $(git -C /app rev-parse --short HEAD)" >> $L; }
log "=== suites v2 start"
for m in rs sa; do
  grep -qx "DONE suite2_$m" $S && continue
  log "start suite2_$m"; bash $Q/run_chunks2.sh $m
  grep -q "ALL CHUNKS DONE" $Q/chunks2_$m/driver.log && { echo "DONE suite2_$m" >> $S; log "done suite2_$m"; }
done
log "=== suites v2 done"
