#!/bin/bash
cd /app/backend
export LOGIN_RATE_LIMIT_BYPASS_TOKEN=kkt-test-bypass-local
python -m pytest tests -q --no-header -p no:cacheprovider > /app/memory/qa/hardening/full_suite_run1.log 2>&1; echo "RUN1 EXIT $?" >> /app/memory/qa/hardening/full_suite_run1.log
python -m pytest tests -q --no-header -p no:cacheprovider > /app/memory/qa/hardening/full_suite_run2.log 2>&1; echo "RUN2 EXIT $?" >> /app/memory/qa/hardening/full_suite_run2.log
