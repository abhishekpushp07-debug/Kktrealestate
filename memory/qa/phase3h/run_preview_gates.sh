#!/bin/bash
# 3H gates on preview (read-only, the live preview backend :8001).
cd /app/backend
set -a; . ./.env; set +a
O=/app/memory/qa/phase3h
: > $O/preview_gate_runs.log
python tools/tieout.py --base http://localhost:8001 --out $O/tieout_preview.md > $O/tieout_preview.log 2>&1; echo "tieout exit $?" >> $O/preview_gate_runs.log
python tools/tieout_reports.py --base http://localhost:8001 > $O/tieout_reports_preview.log 2>&1; echo "tieout_reports exit $?" >> $O/preview_gate_runs.log
python tools/asof_replay.py --base http://localhost:8001 --out $O/asof_replay_preview.md > /dev/null 2>&1; echo "asof_replay exit $?" >> $O/preview_gate_runs.log
python tools/exports_3h.py --base http://localhost:8001 --out $O/exports_test_database.md > /dev/null 2>&1; echo "exports exit $?" >> $O/preview_gate_runs.log
echo DONE >> $O/preview_gate_runs.log
