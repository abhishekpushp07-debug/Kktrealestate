#!/bin/bash
cd /app/backend
export DB_NAME=kkt_volume LOGIN_RATE_LIMIT_BYPASS_TOKEN=kkt-test-bypass-local PUBLIC_SURFACES_ENABLED=false
exec python -m uvicorn server:app --host 127.0.0.1 --port 8002 --log-level warning
