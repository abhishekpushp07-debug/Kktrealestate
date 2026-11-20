#!/bin/bash
# Phase 3G close-out drills on the throw-away copy kkt_audit_scratch (never preview / medium / volume).
cd /app/backend
L=/app/memory/qa/db_audit/gate/drills.log
: > $L
step() { echo "=== $* $(date -u +%H:%M:%S)" >> $L; python -m tools.db_audit_drills "$@" >> $L 2>&1; echo "=== exit $? $(date -u +%H:%M:%S)" >> $L; }
step setup
step races --label final --reps 20
step stale --label final --reps 10
step stale --label final --reps 10 --redis redis://127.0.0.1:6390/0
step startup --label final --reps 10
step dupstart
echo DONE >> $L
