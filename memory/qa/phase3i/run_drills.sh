#!/bin/bash
# 3I closing round: 3G race (20 reps) + 2-process stale drills (10 reps × 3 actions) in both modes.
TAG=${1:-3i}
Q=/app/memory/qa/phase3i
L=$Q/drills_$TAG.log
cd /app/backend
pkill -f "port 810[12]" ; sleep 1
echo "=== drills $TAG $(date -u +%T)" > $L
REDIS=$(command -v redis-server || echo /app/.eqtmp/bin/redis-server)
CLI=$(command -v redis-cli || echo /app/.eqtmp/bin/redis-cli)
$REDIS --port 6390 --save "" --appendonly no --daemonize yes >> $L 2>&1
pkill -f "port 810[12]"; sleep 1; python -m tools.db_audit_drills setup >> $L 2>&1 || { echo SETUP FAILED >> $L; exit 1; }
python -m tools.db_audit_drills races --label $TAG --reps 20 >> $L 2>&1; echo "R races exit $?" >> $L
pkill -f "port 810[12]"; sleep 1; python -m tools.db_audit_drills setup >> $L 2>&1 || { echo SETUP FAILED >> $L; exit 1; }
python -m tools.db_audit_drills races --label $TAG --reps 20 --redis redis://127.0.0.1:6390/0 >> $L 2>&1; echo "R races redis exit $?" >> $L
pkill -f "port 810[12]"; sleep 1; python -m tools.db_audit_drills setup >> $L 2>&1 || { echo SETUP FAILED >> $L; exit 1; }
python -m tools.db_audit_drills stale --label $TAG --reps 10 >> $L 2>&1; echo "S stale exit $?" >> $L
$CLI -p 6390 flushall >> $L 2>&1
pkill -f "port 810[12]"; sleep 1; python -m tools.db_audit_drills setup >> $L 2>&1 || { echo SETUP FAILED >> $L; exit 1; }
python -m tools.db_audit_drills stale --label $TAG --reps 10 --redis redis://127.0.0.1:6390/0 >> $L 2>&1; echo "S stale redis exit $?" >> $L
python -m tools.db_audit_drills teardown >> $L 2>&1
$CLI -p 6390 shutdown nosave >> $L 2>&1
echo "DRILLS DONE $(date -u +%T)" >> $L
