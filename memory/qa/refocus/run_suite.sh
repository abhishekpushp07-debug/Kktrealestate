#!/bin/bash
cd /app/backend
export LOGIN_RATE_LIMIT_BYPASS_TOKEN=kkt-test-bypass-local
python -m pytest tests -q --no-header -p no:cacheprovider > /app/memory/qa/refocus/full_suite.log 2>&1; echo "EXIT $?" >> /app/memory/qa/refocus/full_suite.log
