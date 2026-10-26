#!/bin/bash
cd /app/backend
export DB_NAME=kkt_volume REACT_APP_BACKEND_URL=http://localhost:8002 KKT_TEST_EXTERNAL=1 LOGIN_RATE_LIMIT_BYPASS_TOKEN=kkt-test-bypass-local
: > /app/memory/qa/perf/volume_proofs.log
for t in test_index_audit test_hardening test_erp_leak_scan test_permission_matrix test_fuzz_walker; do
  python -m pytest tests/$t.py -q --no-header -p no:cacheprovider -n 0 2>&1 | tail -1 | sed "s/^/$t: /" >> /app/memory/qa/perf/volume_proofs.log
done
echo DONE >> /app/memory/qa/perf/volume_proofs.log
