#!/bin/bash
# 3I dev: Elite-shape timing of a report subset (scratch copy of kkt_volume). Usage: run_sub.sh OUT keys
cd /app/backend
for p in $(pgrep -f multiprocessing-fork); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -qx DB_NAME=kkt_perf_scratch && kill -9 $p; done
python tools/perf_reports_v3.py --source kkt_volume --workers 2 --cpus 0,1 --cold 10 --warm 10 --only "$2" --out "$1" > "$1.log" 2>&1
echo "exit $?" >> "$1.log"
for p in $(pgrep -f multiprocessing-fork); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -qx DB_NAME=kkt_perf_scratch && kill -9 $p; done
