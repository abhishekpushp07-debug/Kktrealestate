#!/bin/bash
# D0: run each file of the targeted set alone; log per-file peak test-backend RSS + cgroup peak.
cd /app/backend
OUT=/app/memory/qa/phase1/d0_bisect.log
: > $OUT
for f in $(cat /app/memory/qa/phase1/ist_regression_selection.txt); do
  python -m pytest $f -p no:cacheprovider -q > /tmp/d0_one.log 2>&1 &
  P=$!; peak=0; bpeak=0
  while kill -0 $P 2>/dev/null; do
    cg=$(( $(cat /sys/fs/cgroup/memory.current)/1048576 ))
    b=$(ps -eo rss,args | grep "uvicorn server:app" | grep -v grep | grep 8021 | awk '{s+=$1} END {print int(s/1024)}')
    [ "$cg" -gt "$peak" ] && peak=$cg; [ "${b:-0}" -gt "$bpeak" ] && bpeak=${b:-0}
    sleep 1
  done
  echo "$(date -u +%T) $f cg_peak=${peak}MB testbackend_peak=${bpeak}MB $(tail -1 /tmp/d0_one.log)" >> $OUT
done
echo DONE >> $OUT
